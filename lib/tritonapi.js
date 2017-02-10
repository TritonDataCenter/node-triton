/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 */

/* BEGIN JSSTYLED */
/*
 * Core `TritonApi` client class. A TritonApi client object is a wrapper around
 * a lower-level `CloudApi` client that makes raw calls to
 * [Cloud API](https://apidocs.tritondatacenter.com/cloudapi/). The wrapper provides
 * some conveniences, for example:
 * - referring to resources by "shortId" (8-char UUID prefixes) or "name"
 *   (e.g. an VM instance has a unique name for an account, but the raw
 *   Cloud API only supports lookup by full UUID);
 * - filling in of image details for instances which only have an "image_uuid"
 *   in Cloud API responses;
 * - support for waiting for async operations to complete via "wait" parameters;
 * - profile handling.
 *
 *
 * Preparing a TritonApi is a three-step process. (Note: Some users might
 * prefer to use the `createClient` convenience function in "index.js" that
 * wraps up all three steps into a single call.)
 *
 *  1. Create the client object.
 *  2. Initialize it (mainly involves finding the SSH key identified by the
 *     `keyId`).
 *  3. Optionally, unlock the SSH key (if it is passphrase-protected and not in
 *     an ssh-agent). If you know that your key is not passphrase-protected
 *     or is an ssh-agent, then you can skip this step. The failure mode for
 *     a locked key looks like this:
 *          SigningError: error signing request: SSH private key id_rsa is locked (encrypted/password-protected). It must be unlocked before use.
 *              at SigningError._TritonBaseVError (/Users/trentm/tmp/node-triton/lib/errors.js:55:12)
 *              at new SigningError (/Users/trentm/tmp/node-triton/lib/errors.js:173:23)
 *              at CloudApi._getAuthHeaders (/Users/trentm/tmp/node-triton/lib/cloudapi2.js:185:22)
 *
 * # Usage
 *
 *      var mod_triton = require('triton');
 *
 *      // 1. Create the TritonApi instance.
 *      var client = mod_triton.createTritonApiClient({
 *          log: log,
 *          profile: profile,   // See mod_triton.loadProfile
 *          config: config      // See mod_triton.loadConfig
 *      });
 *
 *      // 2. Call `init` to setup the profile. This involves finding the SSH
 *      //    key identified by the profile's keyId.
 *      client.init(function (initErr) {
 *          if (initErr) boom(initErr);
 *
 *          // 3. Unlock the SSH key, if necessary. Possibilities are:
 *          //  (a) Skip this step. If the key is locked, you will get a
 *          //      "SigningError" at first attempt to sign. See example above.
 *          //  (b) The key is not locked.
 *          //      `client.keyPair.isLocked() === false`
 *          //  (c) You have a passphrase for the key:
 *          if (client.keyPair.isLocked()) {
 *              // This throws if the passphrase is incorrect.
 *              client.keyPair.unlock(passphrase);
 *          }
 *
 *          //  (d) Or you use a function that will prompt for a passphrase
 *          //      and unlock with that. E.g., `promptPassphraseUnlockKey`
 *          //      is one provided by this package that with prompt on stdin.
 *          mod_triton.promptPassphraseUnlockKey({
 *              tritonapi: client
 *          }, function (unlockErr) {
 *              if (unlockErr) boom(unlockErr);
 *
 *              // 4. Now you can finally make an API call. For example:
 *              client.listImages(function (err, imgs) {
 *                  // ...
 *              });
 *          });
 *      });
 *
 *
 * # TritonApi method callback patterns
 *
 * Guidelines for the `cb` callback form for TritonApi methods are as follows:
 *
 * - Methods that delete a resource (i.e. call DELETE endpoints on cloudapi)
 *   should have a callback of one of the following forms:
 *          function (err)
 *          function (err, res)             # if 'res' is useful to caller
 *   where `res` is the response object. The latter form is used if there
 *   is a reasonable use case for a caller needing it.
 *
 * - Other methods should have a callback of one of the following forms:
 *          function (err, theThing)
 *          function (err, theThing, res)
 *          function (err, _, res)          # no meaningful body; useful 'res'
 *          function (err)
 *   `res` is the response object (from the original cloudapi request, in
 *   the case of methods that make an async request, and then poll waiting
 *   for completion). `theThing` is an endpoint-specific object. Typically it
 *   is the parsed JSON body from the cloudapi response. In some cases there
 *   is no meaningful response body (e.g. for RenameMachine), but the res can
 *   be useful. Here we use `_` to put a placeholder for the body, and keep
 *   `res` in the third position.
 */
/* END JSSTYLED */

var assert = require('assert-plus');
var auth = require('smartdc-auth');
var fs = require('fs');
var format = require('util').format;
var jsprim = require('jsprim');
var mkdirp = require('mkdirp');
var once = require('once');
var path = require('path');
// We are cheating here. restify-clients should export its 'bunyan'.
var restifyBunyanSerializers =
    require('restify-clients/lib/helpers/bunyan').serializers;
var tabula = require('tabula');
var vasync = require('vasync');
var VError = require('verror');
var sshpk = require('sshpk');

var cloudapi = require('./cloudapi2');
var common = require('./common');
var errors = require('./errors');


// ---- globals

var CLOUDAPI_ACCEPT_VERSION = '~9||~8';



// ---- internal support stuff

function _assertRoleTagResourceType(resourceType, errName) {
    assert.string(resourceType, errName);
    var knownResourceTypes = ['resource', 'instance', 'image',
        'package', 'network'];
    assert.ok(knownResourceTypes.indexOf(resourceType) !== -1,
        'unknown resource type: ' + resourceType);
}

function _roleTagResourceUrl(account, type, id) {
    var ns = {
        instance: 'machines',
        image: 'images',
        'package': 'packages',
        network: 'networks'
    }[type];
    assert.ok(ns, 'unknown resource type: ' + type);

    return format('/%s/%s/%s', account, ns, id);
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.id`
 * instance name, shortid or uuid, and determines the instance id (setting it
 * as `arg.instId`).
 */
function _stepInstId(arg, next) {
    assert.object(arg.client, 'arg.client');
    assert.string(arg.id, 'arg.id');

    if (common.isUUID(arg.id)) {
        arg.instId = arg.id;
        next();
    } else {
        arg.client.getInstance({
            id: arg.id,
            fields: ['id']
        }, function (err, inst) {
            if (err) {
                next(err);
            } else {
                arg.instId = inst.id;
                next();
            }
        });
    }
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.id`
 * volume name, shortid or uuid, and determines the volume id (setting it
 * as `arg.volId`).
 */
function _stepVolId(arg, next) {
    assert.object(arg.client, 'arg.client');
    assert.string(arg.id, 'arg.id');

    if (common.isUUID(arg.id)) {
        arg.volId = arg.id;
        next();
    } else {
        arg.client.getVolume(arg.id, function onGetVolume(getVolErr, vol) {
            if (getVolErr) {
                next(getVolErr);
            } else {
                arg.volId = vol.id;
                next();
            }
        });
    }
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.package`
 * package name, short id or uuid, and determines the package id (setting it
 * as `arg.pkgId`). Also sets `arg.pkgName` so that we can use this to test when
 * the instance has been updated.
 */
function _stepPkgId(arg, next) {
    assert.object(arg.client, 'arg.client');
    assert.string(arg.package, 'arg.package');

    arg.client.getPackage(arg.package, function (err, pkg) {
        if (err) {
            next(err);
        } else {
            arg.pkgId = pkg.id;
            arg.pkgName = pkg.name;
            next();
        }
    });
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.image`
 * image name, shortid, or uuid, and determines the image object (setting it
 * as arg.img).
 */
function _stepImg(arg, next) {
    assert.object(arg.client, 'arg.client');
    assert.string(arg.image, 'arg.image');

    arg.client.getImage(arg.image, function (err, img) {
        if (err) {
            next(err);
        } else {
            arg.img = img;
            next();
        }
    });
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.id`
 * fwrule shortid or uuid, and determines the fwrule id (setting it
 * as `arg.fwruleId`).
 *
 * If the fwrule *was* retrieved, that is set as `arg.fwrule`.
 */
function _stepFwRuleId(arg, next) {
    assert.object(arg.client, 'arg.client');
    assert.string(arg.id, 'arg.id');

    if (common.isUUID(arg.id)) {
        arg.fwruleId = arg.id;
        next();
    } else {
        arg.client.getFirewallRule(arg.id, function (err, fwrule) {
            if (err) {
                next(err);
            } else {
                arg.fwruleId = fwrule.id;
                next();
            }
        });
    }
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.network`
 * (or `arg.id` if there is no `arg.network`) network name, shortid or uuid,
 * and determines the network id (setting it as `arg.netId`).
 */
function _stepNetId(arg, next) {
    assert.object(arg, 'arg');
    assert.object(arg.client, 'arg.client');
    assert.func(next, 'next');

    var id = arg.network || arg.id;
    assert.string(id, 'arg.network || arg.id');

    if (common.isUUID(id)) {
        arg.netId = id;
        next();
    } else {
        arg.client.getNetwork(id, function onGet(err, net) {
            if (err) {
                next(err);
            } else {
                arg.netId = net.id;
                next();
            }
        });
    }
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a `arg.id` and
 * optionally a `arg.vlan_id`, where `arg.id` is a network name, shortid or
 * uuid, and `arg.vlan_id` is a VLAN's id or name. Sets the network id as
 * `arg.netId` and the VLAN id as `arg.vlanId`.
 */
function _stepFabricNetId(arg, next) {
    assert.object(arg, 'arg');
    assert.object(arg.client, 'arg.client');
    assert.string(arg.id, 'arg.id');
    assert.func(next, 'next');

    var id = arg.id;
    var vlanId = arg.vlan_id;
    var vlanIdType = typeof (vlanId);

    if (common.isUUID(id) && vlanIdType === 'number') {
        arg.netId = id;
        arg.vlanId = vlanId;

        next();
        return;
    }

    arg.client.getNetwork(id, function onGetNetwork(err, net) {
        if (err) {
            next(err);
            return;
        }

        if (vlanIdType === 'number') {
            assert.equal(net.vlan_id, vlanId, 'VLAN belongs to network');
        }

        if (vlanIdType === 'number' || vlanIdType === 'undefined') {
            arg.netId = net.id;
            arg.vlanId = net.vlan_id;

            next();
            return;
        }

        // at this point the only type left we support are strings
        assert.string(vlanId, 'arg.vlan_id');

        arg.client.getFabricVlan(vlanId, function onGetFabric(err2, vlan) {
            if (err2) {
                next(err2);
                return;
            }

            assert.equal(net.vlan_id, vlan.vlan_id, 'VLAN belongs to network');
            arg.netId = net.id;
            arg.vlanId = net.vlan_id;
            next();
        });
    });
}

/**
 * A function appropriate for `vasync.pipeline` funcs that takes a
 * `arg.vlan_id`, where that is either a VLAN's id or name. Sets the
 * VLAN id as `arg.vlanId`.
 */
function _stepFabricVlanId(arg, next) {
    assert.object(arg, 'arg');
    assert.object(arg.client, 'arg.client');
    assert.ok(typeof (arg.vlan_id) === 'string' ||
              typeof (arg.vlan_id) === 'number', 'arg.vlan_id');
    assert.func(next, 'next');

    var vlanId = arg.vlan_id;

    if (typeof (vlanId) === 'number') {
        arg.vlanId = vlanId;
        next();
        return;
    }

    arg.client.getFabricVlan(vlanId, function onGet(err, vlan) {
        if (err) {
            next(err);
            return;
        }

        arg.vlanId = vlan.vlan_id;
        next();
    });
}



// ---- TritonApi class

/**
 * Create a TritonApi client.
 *
 * Public properties (TODO: doc all of these):
 *      - profile
 *      - config
 *      - log
 *      - cacheDir (only available if configured with a configDir)
 *      - keyPair (available after init)
 *      - cloudapi (available after init)
 *
 * @param opts {Object}
 *      - log {Bunyan Logger}
 *      ...
 */
function TritonApi(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.profile, 'opts.profile');
    assert.object(opts.config, 'opts.config');

    this.profile = opts.profile;
    this.config = opts.config;
    this.keyPair = null;

    // Make sure a given bunyan logger has reasonable client_re[qs] serializers.
    // Note: This was fixed in restify, then broken again in
    // https://github.com/mcavage/node-restify/pull/501
    if (opts.log.serializers &&
        (!opts.log.serializers.client_req ||
        !opts.log.serializers.client_req)) {
        this.log = opts.log.child({
            serializers: restifyBunyanSerializers
        });
    } else {
        this.log = opts.log;
    }

    if (this.config._configDir) {
        this.cacheDir = path.resolve(this.config._configDir,
            this.config.cacheDir,
            common.profileSlug(this.profile));
        this.log.trace({cacheDir: this.cacheDir}, 'cache dir');
    }
}


TritonApi.prototype.close = function close() {
    if (this.cloudapi) {
        this.cloudapi.close();
        delete this.cloudapi;
    }
};


TritonApi.prototype.init = function init(cb) {
    var self = this;
    if (this.cacheDir) {
        fs.exists(this.cacheDir, function (exists) {
            if (!exists) {
                mkdirp(self.cacheDir, function (err) {
                    if (err) {
                        cb(err);
                        return;
                    }
                    self._setupProfile(cb);
                });
            } else {
                self._setupProfile(cb);
            }
        });
    } else {
        self._setupProfile(cb);
    }
};

TritonApi.prototype._setupProfile = function _setupProfile(cb) {
    var self = this;
    var profile = this.profile;

    assert.object(profile, 'profile');
    assert.string(profile.account, 'profile.account');
    assert.optionalString(profile.actAsAccount, 'profile.actAsAccount');
    assert.string(profile.keyId, 'profile.keyId');
    assert.string(profile.url, 'profile.url');
    assert.optionalString(profile.user, 'profile.user');
    assert.optionalArrayOfString(profile.roles, 'profile.roles');
    assert.optionalString(profile.privKey, 'profile.privKey');
    assert.optionalBool(profile.insecure, 'profile.insecure');
    assert.optionalString(profile.acceptVersion, 'profile.acceptVersion');

    var rejectUnauthorized = (profile.insecure === undefined
        ? true : !profile.insecure);
    var acceptVersion = profile.acceptVersion || CLOUDAPI_ACCEPT_VERSION;

    self._cloudapiOpts = {
        url: profile.url,
        account: profile.actAsAccount || profile.account,
        principal: {
            account: profile.account,
            user: profile.user
        },
        roles: profile.roles,
        version: acceptVersion,
        rejectUnauthorized: rejectUnauthorized,
        log: this.log
    };

    if (profile.privKey) {
        var key = sshpk.parsePrivateKey(profile.privKey);
        this.keyPair =
            self._cloudapiOpts.principal.keyPair =
            auth.KeyPair.fromPrivateKey(key);
        this.cloudapi = cloudapi.createClient(self._cloudapiOpts);
        cb(null);
    } else {
        var kr = new auth.KeyRing();
        var fp = sshpk.parseFingerprint(profile.keyId);
        kr.findSigningKeyPair(fp, function (err, kp) {
            if (err) {
                cb(err);
                return;
            }
            self.keyPair = self._cloudapiOpts.principal.keyPair = kp;
            self.cloudapi = cloudapi.createClient(self._cloudapiOpts);
            cb(null);
        });
    }
};


TritonApi.prototype._cachePutJson = function _cachePutJson(key, obj, cb) {
    var self = this;
    assert.string(this.cacheDir, 'this.cacheDir');
    assert.string(key, 'key');
    assert.object(obj, 'obj');
    assert.func(cb, 'cb');

    var keyPath = path.resolve(this.cacheDir, key);
    var data = JSON.stringify(obj);
    fs.writeFile(keyPath, data, {encoding: 'utf8'}, function (err) {
        if (err) {
            self.log.info({err: err, keyPath: keyPath}, 'error caching');
        }
        cb();
    });
};

/**
 * Lookup the given key in the cache and return a hit or `undefined`.
 *
 * @param {String} key: The cache key, e.g. 'images.json'.
 * @param {Number} ttl: The number of seconds the cached data is valid.
 * @param {Function} cb: `function (err, hit)`.
 *      `err` is an Error if there was an unexpected error loading from the
 *      cache. `hit` is undefined if there was no cache hit. On a hit, the
 *      type of `hit` depends on the key.
 */
TritonApi.prototype._cacheGetJson = function _cacheGetJson(key, ttl, cb) {
    var self = this;
    assert.string(this.cacheDir, 'this.cacheDir');
    assert.string(key, 'key');
    assert.number(ttl, 'ttl');
    assert.func(cb, 'cb');

    var keyPath = path.resolve(this.cacheDir, key);
    fs.stat(keyPath, function (statErr, stats) {
        if (!statErr &&
            // TTL is in seconds so we need to multiply by 1000.
            stats.mtime.getTime() + (ttl * 1000) >= (new Date()).getTime()) {
            fs.readFile(keyPath, 'utf8', function (err, data) {
                if (err && err.code === 'ENOENT') {
                    self.log.trace({keyPath: keyPath},
                                   'cache file does not exist');
                    cb();
                } else if (err) {
                    self.log.warn({err: err, keyPath: keyPath},
                                  'error reading cache file');
                    cb();
                }
                var obj;
                try {
                    obj = JSON.parse(data);
                } catch (dataErr) {
                    self.log.trace({err: dataErr, keyPath: keyPath},
                                   'error parsing JSON cache file, removing');
                    fs.unlink(keyPath, function (err2) {
                        if (err2) {
                            self.log.warn({err: err2},
                                          'failed to remove JSON cache file');
                        }
                        cb();
                    });
                    return;
                }
                cb(null, obj);
            });
        } else if (statErr && statErr.code !== 'ENOENT') {
            cb(statErr);
        } else {
            cb();
        }
    });
};


/**
 * CloudAPI listImages wrapper with optional caching.
 *
 * @param opts {Object} Optional.
 *      - useCache {Boolean} Default false. Whether to use Triton's local cache.
 *        Currently the cache is only used and updated if the filters are
 *        exactly `{state: "all"}`. IOW, the ListImages call that returns
 *        all visible images.
 *      - ... all other cloudapi ListImages options per
 *        <https://apidocs.tritondatacenter.com/cloudapi/#ListImages>
 * @param {Function} callback `function (err, imgs)`
 */
TritonApi.prototype.listImages = function listImages(opts, cb) {
    var self = this;
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.object(opts, 'opts');
    assert.optionalBool(opts.useCache, 'opts.useCache');
    assert.func(cb, 'cb');

    var listOpts = common.objCopy(opts);
    delete listOpts.useCache;

    // For now at least, we only cache full results (no filtering).
    var useCache = Boolean(opts.useCache);
    var cacheKey;
    if (Object.keys(listOpts).length === 1 && listOpts.state === 'all') {
        cacheKey = 'images.json';
    } else {
        useCache = false;
    }
    var cached;
    var fetched;
    var res;

    vasync.pipeline({funcs: [
        function tryCache(_, next) {
            if (!useCache) {
                return next();
            }
            self._cacheGetJson(cacheKey, 5 * 60, function (err, cached_) {
                if (err) {
                    return next(err);
                }
                cached = cached_;
                next();
            });
        },

        function listImgs(_, next) {
            if (cached) {
                return next();
            }

            self.cloudapi.listImages(listOpts, function (err, imgs, res_) {
                if (err) {
                    return next(err);
                }
                fetched = imgs;
                res = res_;
                next();
            });
        },

        function cacheFetched(_, next) {
            if (cacheKey && fetched) {
                self._cachePutJson(cacheKey, fetched, next);
            } else {
                next();
            }
        }

    ]}, function (err) {
        if (err) {
            cb(err, null, res);
        } else {
            cb(null, fetched || cached, res);
        }
    });
};


/**
 * Get an image by ID, exact name, or short ID, in that order.
 *
 * If there is more than one image with that name, then the latest
 * (by published_at) is returned.
 *
 * @param {Boolean} opts.excludeInactive - Exclude inactive images when
 *      matching. By default inactive images are included. This param is *not*
 *      used when a full image ID (a UUID) is given.
 */
TritonApi.prototype.getImage = function getImage(opts, cb) {
    var self = this;
    if (typeof (opts) === 'string')
        opts = {name: opts};
    assert.object(opts, 'opts');
    assert.string(opts.name, 'opts.name');
    assert.optionalBool(opts.excludeInactive, 'opts.excludeInactive');
    assert.optionalBool(opts.useCache, 'opts.useCache');
    assert.func(cb, 'cb');

    var excludeInactive = Boolean(opts.excludeInactive);
    var img;

    if (common.isUUID(opts.name)) {
        vasync.pipeline({funcs: [
            function tryCache(_, next) {
                if (!opts.useCache) {
                    next();
                    return;
                }
                var cacheKey = 'images.json';
                self._cacheGetJson(cacheKey, 60 * 60, function (err, images) {
                    if (err) {
                        next(err);
                        return;
                    }
                    if (images) {
                        for (var i = 0; i < images.length; i++) {
                            if (images[i].id === opts.name) {
                                img = images[i];
                                break;
                            }
                        }
                    }
                    next();
                });
            },
            function cloudApiGetImage(_, next) {
                if (img !== undefined) {
                    next();
                    return;
                }
                self.cloudapi.getImage({id: opts.name}, function (err, img_) {
                    img = img_;
                    if (err && err.restCode === 'ResourceNotFound') {
                        err = new errors.ResourceNotFoundError(err, format(
                            'image with id %s was not found', opts.name));
                    }
                    next(err);
                });
            }
        ]}, function done(err) {
            if (err) {
                cb(err);
            } else {
                cb(null, img);
            }
        });
    } else {
        var s = opts.name.split('@');
        var name = s[0];
        var version = s[1];
        var nameSelector;

        var listOpts = {};
        listOpts.state = (excludeInactive ? 'active' : 'all');
        if (version) {
            nameSelector = name + '@' + version;
            listOpts.name = name;
            listOpts.version = version;
            // XXX This is bogus now?
            listOpts.useCache = opts.useCache;
        } else {
            nameSelector = name;
        }
        this.cloudapi.listImages(listOpts, function (err, imgs) {
            if (err) {
                return cb(err);
            }

            var nameMatches = [];
            var shortIdMatches = [];
            for (var i = 0; i < imgs.length; i++) {
                img = imgs[i];
                if (img.name === name) {
                    nameMatches.push(img);
                }
                if (common.uuidToShortId(img.id) === name) {
                    shortIdMatches.push(img);
                }
            }

            if (nameMatches.length === 1) {
                cb(null, nameMatches[0]);
            } else if (nameMatches.length > 1) {
                tabula.sortArrayOfObjects(nameMatches, 'published_at');
                cb(null, nameMatches[nameMatches.length - 1]);
            } else if (shortIdMatches.length === 1) {
                cb(null, shortIdMatches[0]);
            } else if (shortIdMatches.length === 0) {
                cb(new errors.ResourceNotFoundError(format(
                    'no image with %s or short id "%s" was found',
                    nameSelector, name)));
            } else {
                cb(new errors.ResourceNotFoundError(
                    format('no image with %s "%s" was found '
                    + 'and "%s" is an ambiguous short id',
                    nameSelector, name, name)));
            }
        });
    }
};

/**
 * Export and image to Manta.
 *
 * @param {Object} opts
 *      - {String} image The image UUID, name, or short ID.  Required.
 *      - {String} manta_path The path in Manta where the image will be
 *                 exported.  Required.
 * @param {Function} cb `function (err, exportInfo, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `exportInfo` is an object with three properties:
 *          - {String} manta_url The url of the Manta API endpoint where the
 *                     image was exported.
 *          - {String} manifest_path The pathname in Manta of the exported image
 *                     manifest.
 *          - {String} image_path The pathname in Manta of the exported image.
 *          and `res` is the CloudAPI `ExportImage` response.
 */
TritonApi.prototype.exportImage = function exportImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.image, 'opts.image');
    assert.string(opts.manta_path, 'opts.manta_path');
    assert.func(cb, 'cb');

    var res = null;
    var exportInfo = null;
    var arg = {
        image: opts.image,
        client: self
    };

    vasync.pipeline({arg: arg, funcs: [
        _stepImg,
        function cloudApiExportImage(ctx, next) {
            self.cloudapi.exportImage({
                id: ctx.img.id, manta_path: opts.manta_path },
                function (err, exportInfo_, res_) {
                    if (err) {
                        next(err);
                        return;
                    }

                    exportInfo = exportInfo_;
                    res = res_;
                    next();
                });
        }
    ]}, function (err) {
        cb(err, exportInfo, res);
    });
};

/**
 * Share an image with another account.
 *
 * @param {Object} opts
 *      - {String} image The image UUID, name, or short ID.  Required.
 *      - {String} account The account UUID.  Required.
 * @param {Function} cb `function (err, img)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `img` is an image object.
 */
TritonApi.prototype.shareImage = function shareImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.image, 'opts.image');
    assert.string(opts.account, 'opts.account');
    assert.func(cb, 'cb');

    var arg = {
        image: opts.image,
        client: self
    };
    var res;

    vasync.pipeline({arg: arg, funcs: [
        _stepImg,
        function validateAcl(ctx, next) {
            ctx.acl = ctx.img.acl && ctx.img.acl.slice() || [];
            if (ctx.acl.indexOf(opts.account) === -1) {
                ctx.acl.push(opts.account);
            }
            next();
        },
        function cloudApiShareImage(ctx, next) {
            self.cloudapi.updateImage({id: ctx.img.id, fields: {acl: ctx.acl}},
                    function _updateImageCb(err, img) {
                res = img;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};

/**
 * Unshare an image with another account.
 *
 * @param {Object} opts
 *      - {String} image The image UUID, name, or short ID.  Required.
 *      - {String} account The account UUID.  Required.
 * @param {Function} cb `function (err, img)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `img` is an image object.
 */
TritonApi.prototype.unshareImage = function unshareImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.image, 'opts.image');
    assert.string(opts.account, 'opts.account');
    assert.func(cb, 'cb');

    var arg = {
        image: opts.image,
        client: self
    };
    var res;

    vasync.pipeline({arg: arg, funcs: [
        _stepImg,
        function validateAcl(ctx, next) {
            assert.object(ctx.img, 'img');
            ctx.acl = ctx.img.acl && ctx.img.acl.slice() || [];
            var aclIdx = ctx.acl.indexOf(opts.account);
            if (aclIdx === -1) {
                cb(new errors.TritonError(format('image is not shared with %s',
                    opts.account)));
                return;
            }
            ctx.acl.splice(aclIdx, 1);
            next();
        },
        function cloudApiUnshareImage(ctx, next) {
            self.cloudapi.updateImage({id: ctx.img.id, fields: {acl: ctx.acl}},
                    function _updateImageCb(err, img) {
                res = img;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};

/**
 * Clone a shared image.
 *
 * @param {Object} opts
 *      - {String} image The image UUID, name, or short ID.  Required.
 * @param {Function} cb `function (err, img)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `img` is the cloned image object.
 */
TritonApi.prototype.cloneImage = function cloneImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.image, 'opts.image');
    assert.func(cb, 'cb');

    var arg = {
        image: opts.image,
        client: self
    };
    var img;

    vasync.pipeline({arg: arg, funcs: [
        _stepImg,
        function cloudApiCloneImage(ctx, next) {
            self.cloudapi.cloneImage({id: ctx.img.id},
                    function _cloneImageCb(err, img_) {
                img = img_;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, img);
    });
};

/**
 * Copy an image to another Datacenter.
 *
 * Note: This somewhat flips the sense of the CloudAPI ImportImageFromDatacenter
 * endpoint, in that it instead calls *the target DC* to pull from this
 * profile's DC. The target DC's CloudAPI URL is determined from this DC's
 * `ListDatacenters` endpoint. It is assumed that all other Triton profile
 * attributes (account, keyId) suffice to auth with the target DC.
 *
 * @param {Object} opts
 *      - {String} datacenter The datacenter name to copy to.  Required.
 *      - {String} image The image UUID, name, or short ID.  Required.
 * @param {Function} cb `function (err, img)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `img` is the copied image object.
 */
TritonApi.prototype.copyImageToDatacenter =
function copyImageToDatacenter(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.datacenter, 'opts.datacenter');
    assert.string(opts.image, 'opts.image');
    assert.func(cb, 'cb');

    var arg = {
        client: self,
        datacenter: opts.datacenter,
        image: opts.image
    };
    var img;

    vasync.pipeline({arg: arg, funcs: [
        _stepImg,
        function getDatacenters(ctx, next) {
            self.cloudapi.listDatacenters({}, function (err, dcs, res) {
                if (err) {
                    next(err);
                    return;
                }
                if (!dcs.hasOwnProperty(ctx.datacenter)) {
                    next(new errors.TritonError(format(
                        '"%s" is not a valid datacenter name, possible ' +
                        'names are: %s',
                        ctx.datacenter,
                        Object.keys(dcs).join(', '))));
                    return;
                }
                ctx.datacenterUrl = dcs[ctx.datacenter];
                assert.string(ctx.datacenterUrl, 'ctx.datacenterUrl');

                // CloudAPI added image copying in 9.2.0, which is also
                // the version that included this header.
                var currentDcName = res.headers['triton-datacenter-name'];
                if (!currentDcName) {
                    next(new errors.TritonError(err, format(
                        'this datacenter does not support image copying (%s)',
                        res.headers['server'])));
                    return;
                }
                // Note: currentDcName is where the image currently resides.
                ctx.currentDcName = currentDcName;

                next();
            });
        },
        function cloudApiImportImageFromDatacenter(ctx, next) {
            var targetCloudapiOpts = jsprim.mergeObjects(
                {
                    url: ctx.datacenterUrl,
                    log: self.log.child({datacenter: opts.datacenter}, true)
                },
                null,
                self._cloudapiOpts
            );
            var targetCloudapi = cloudapi.createClient(targetCloudapiOpts);

            targetCloudapi.importImageFromDatacenter({
                datacenter: ctx.currentDcName,
                id: ctx.img.id
            }, function _importImageCb(err, img_) {
                targetCloudapi.close();
                img = img_;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, img);
    });
};


/**
 * Update an image.
 *
 * @param {Object} opts
 *      - {String} image The image UUID, name, or short ID.  Required.
 *      - {Object} fields The image fields to update. Required.
 * @param {Function} cb `function (err, img)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `img` is an image object.
 */
TritonApi.prototype.updateImage = function updateImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.image, 'opts.image');
    assert.object(opts.fields, 'opts.fields');
    assert.func(cb, 'cb');

    var arg = {
        image: opts.image,
        fields: opts.fields,
        client: self
    };
    var res;

    vasync.pipeline({ arg: arg, funcs: [
        _stepImg,
        function cloudApiUpdateImage(ctx, next) {
            self.cloudapi.updateImage({
                id: ctx.img.id,
                fields: ctx.fields
            }, function _updateImageCb(err, img) {
                res = img;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};

/**
 * Get an active package by ID, exact name, or short ID, in that order.
 *
 * If there is more than one package with that name, then this errors out.
 */
TritonApi.prototype.getPackage = function getPackage(name, cb) {
    assert.string(name, 'name');
    assert.func(cb, 'cb');

    if (common.isUUID(name)) {
        this.cloudapi.getPackage({id: name}, function (err, pkg) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    err = new errors.ResourceNotFoundError(err,
                        format('package with id %s was not found', name));
                }
                cb(err);
            } else {
                cb(null, pkg);
            }
        });
    } else {
        this.cloudapi.listPackages(function (err, pkgs) {
            if (err) {
                return cb(err);
            }

            var nameMatches = [];
            var shortIdMatches = [];
            for (var i = 0; i < pkgs.length; i++) {
                var pkg = pkgs[i];
                if (pkg.name === name) {
                    nameMatches.push(pkg);
                }
                if (pkg.id.slice(0, 8) === name) {
                    shortIdMatches.push(pkg);
                }
            }

            if (nameMatches.length === 1) {
                cb(null, nameMatches[0]);
            } else if (nameMatches.length > 1) {
                cb(new errors.TritonError(format(
                    'package name "%s" is ambiguous: matches %d packages',
                    name, nameMatches.length)));
            } else if (shortIdMatches.length === 1) {
                cb(null, shortIdMatches[0]);
            } else if (shortIdMatches.length === 0) {
                cb(new errors.ResourceNotFoundError(format(
                    'no package with name or short id "%s" was found', name)));
            } else {
                cb(new errors.ResourceNotFoundError(
                    format('no package with name "%s" was found '
                    + 'and "%s" is an ambiguous short id', name)));
            }
        });
    }
};


/**
 * Get an network by ID, exact name, or short ID, in that order.
 *
 * If the name is ambiguous, then this errors out.
 */
TritonApi.prototype.getNetwork = function getNetwork(name, cb) {
    assert.string(name, 'name');
    assert.func(cb, 'cb');

    if (common.isUUID(name)) {
        this.cloudapi.getNetwork(name, function onGet(err, net) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    // Wrap with *our* ResourceNotFound for exitStatus=3.
                    err = new errors.ResourceNotFoundError(err,
                        format('network with id %s was not found', name));
                }
                cb(err);
            } else {
                cb(null, net);
            }
        });
    } else {
        this.cloudapi.listNetworks({}, function onList(err, nets) {
            if (err) {
                return cb(err);
            }

            var nameMatches = [];
            var shortIdMatches = [];
            for (var i = 0; i < nets.length; i++) {
                var net = nets[i];
                if (net.name === name) {
                    nameMatches.push(net);
                }
                if (net.id.slice(0, 8) === name) {
                    shortIdMatches.push(net);
                }
            }

            if (nameMatches.length === 1) {
                cb(null, nameMatches[0]);
            } else if (nameMatches.length > 1) {
                cb(new errors.TritonError(format(
                    'network name "%s" is ambiguous: matches %d networks',
                    name, nameMatches.length)));
            } else if (shortIdMatches.length === 1) {
                cb(null, shortIdMatches[0]);
            } else if (shortIdMatches.length === 0) {
                cb(new errors.ResourceNotFoundError(format(
                    'no network with name or short id "%s" was found', name)));
            } else {
                cb(new errors.ResourceNotFoundError(format(
                    'no network with name "%s" was found '
                    + 'and "%s" is an ambiguous short id', name)));
            }
        });
    }
};


/**
 * List all fabric networks on a VLAN. Takes a network's VLAN ID or name as an
 * argument.
 */
TritonApi.prototype.listFabricNetworks =
function listFabricNetworks(opts, cb) {
    assert.object(opts, 'opts');
    assert.ok(typeof (opts.vlan_id) === 'string' ||
              typeof (opts.vlan_id) === 'number', 'opts.vlan_id');
    assert.func(cb, 'cb');

    var self = this;
    var networks;

    vasync.pipeline({
        arg: {client: self, vlan_id: opts.vlan_id}, funcs: [
        _stepFabricVlanId,

        function listNetworks(arg, next) {
            self.cloudapi.listFabricNetworks({
                vlan_id: arg.vlanId
            }, function listCb(err, nets) {
                if (err) {
                    next(err);
                    return;
                }

                networks = nets;

                next();
            });
        }
    ]}, function (err) {
        cb(err, networks);
    });
};


/**
 * Delete a fabric network by ID, exact name, or short ID, in that order.
 * Can accept a network's VLAN ID or name as an optional argument.
 *
 * If the name is ambiguous, then this errors out.
 */
TritonApi.prototype.deleteFabricNetwork =
function deleteFabricNetwork(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;

    vasync.pipeline({
        arg: {client: self, id: opts.id, vlan_id: opts.vlan_id},
    funcs: [
        _stepFabricNetId,

        function deleteNetwork(arg, next) {
            self.cloudapi.deleteFabricNetwork({
                id: arg.netId, vlan_id: arg.vlanId
            }, next);
        }
    ]}, cb);
};

/**
 * List a network's IPs.
 *
 * @param {String} name The network UUID, name, or short ID. Required.
 * @param {Function} cb `function (err, ip, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `net` is an array of ip objects
 */
TritonApi.prototype.listNetworkIps = function listNetworkIps(name, cb) {
    assert.string(name, 'name');
    assert.func(cb, 'cb');

    var self = this;
    var ipArray;
    var res;

    vasync.pipeline({arg: {client: self, id: name}, funcs: [
        _stepNetId,

        function getIp(arg, next) {
            self.cloudapi.listNetworkIps(arg.netId,
                    function (err, ips, _res) {
                res = _res;
                ipArray = ips;

                if (err && err.restCode === 'ResourceNotFound' &&
                    err.exitStatus !== 3) {
                    // Wrap with *our* ResourceNotFound for exitStatus=3.
                    err = new errors.ResourceNotFoundError(err,
                        format('network with id %s was not found', name));
                }
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, ipArray, res);
    });
};

/**
 * Get a network IP.
 *
 * @param {Object} opts
 *      - {String} id - The network UUID, name, or shortID. Required.
 *      - {String} ip - The IP. Required.
 * @param {Function} cb `function (err, ip, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `ip` is an ip object
 */
TritonApi.prototype.getNetworkIp = function getNetworkIp(opts, cb) {
    assert.string(opts.id, 'id');
    assert.string(opts.ip, 'userIp');
    assert.func(cb, 'cb');

    var self = this;
    var ipObj;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepNetId,

        function getIp(arg, next) {
            self.cloudapi.getNetworkIp({id: arg.netId,
                    ip: opts.ip}, function (err, ip, _res) {
                res = _res;
                ipObj = ip;

                if (err && err.restCode === 'ResourceNotFound' &&
                    err.exitStatus !== 3) {
                    // Wrap with *our* ResourceNotFound for exitStatus=3.
                    err = new errors.ResourceNotFoundError(err,
                        format('network with id %s was not found', opts.id));
                }
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, ipObj, res);
    });
};

/**
 * Modify a network IP.
 *
 * @param {Object} opts
 *      - {String} id - The network UUID, name, or shortID. Required.
 *      - {String} ip - The IP. Required.
 *      # The updateable fields
 *      - {Boolean} reserved - Reserve the IP. Required.
 * @param {Function} cb `function (err, ip, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `obj` is an ip object
 */
TritonApi.prototype.updateNetworkIp = function updateNetworkIp(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.string(opts.ip, 'opts.ip');
    assert.bool(opts.reserved, 'opts.reserved');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var body;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepNetId,

        function updateIp(arg, next) {
            opts.id = arg.netId;
            self.cloudapi.updateNetworkIp(opts, function (err, _body, _res) {
                res = _res;
                body = _body;

                if (err && err.restCode === 'ResourceNotFound' &&
                    err.exitStatus !== 3) {
                    // Wrap with *our* ResourceNotFound for exitStatus=3.
                    err = new errors.ResourceNotFoundError(err,
                        format('IP %s was not found in network %s',
                        opts.ip, opts.id));
                }

                next(err);
            });
        }
    ]}, function (err) {
        cb(err, body, res);
    });
};


/**
 * Connect to CloudAPI's feed of machines changes using websockets
 * @param {Function} callback of the form `function (err, shed)`
 */
TritonApi.prototype.changeFeed = function changeFeed(cb) {
    assert.func(cb, 'cb');

    this.cloudapi.changeFeed(cb);
};

/**
 * Get an instance.
 *
 * Alternative call signature: `getInstance(id, cb)`.
 *
 * @param {Object} opts
 *      - {UUID} id: The instance ID, name, or short ID. Required.
 *      - {Array} fields: Optional. An array of instance field names that are
 *        wanted by the caller. This *can* allow the implementation to avoid
 *        extra API calls. E.g. `['id', 'name']`.
 *      - {Boolean} credentials: Optional. Set to true to include generated
 *        credentials for this instance in `inst.metadata.credentials`.
 * @param {Function} cb `function (err, inst, res)`
 *      Note that deleted instances will result in `err` being a
 *      `InstanceDeletedError` and `inst` being defined. On success, `res` is
 *      the response object from a `GetMachine`, if one was made (possibly not
 *      if the instance was retrieved from `ListMachines` calls).
 */
TritonApi.prototype.getInstance = function getInstance(opts, cb) {
    var self = this;
    if (typeof (opts) === 'string') {
        opts = {id: opts};
    }
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.optionalArrayOfString(opts.fields, 'opts.fields');
    assert.optionalBool(opts.credentials, 'opts.credentials');
    assert.func(cb, 'cb');

    /*
     * Some wrapping/massaging of some CloudAPI GetMachine errors.
     */
    var errFromGetMachineErr = function (err) {
        if (!err) {
            // jsl:pass
        } else if (err.restCode === 'ResourceNotFound') {
            // The CloudApi 404 error message sucks: "VM not found".
            err = new errors.ResourceNotFoundError(err,
                format('instance with id %s was not found', opts.id));
        } else if (err.statusCode === 410) {
            // GetMachine returns '410 Gone' for deleted machines.
            err = new errors.InstanceDeletedError(err,
                format('instance %s was deleted', opts.id));
        }
        return err;
    };

    var res;
    var shortId;
    var inst;
    var instFromList;

    vasync.pipeline({funcs: [
        function tryUuid(_, next) {
            var uuid;
            if (common.isUUID(opts.id)) {
                uuid = opts.id;
            } else {
                shortId = common.normShortId(opts.id);
                if (shortId && common.isUUID(shortId)) {
                    // E.g. a >32-char docker container ID normalized to a UUID.
                    uuid = shortId;
                } else {
                    return next();
                }
            }
            self.cloudapi.getMachine({
                id: uuid,
                credentials: opts.credentials
            }, function onMachine(err, inst_, res_) {
                res = res_;
                inst = inst_;
                err = errFromGetMachineErr(err);
                next(err);
            });
        },

        function tryName(_, next) {
            if (inst || instFromList) {
                return next();
            }
            self.cloudapi.listMachines({name: opts.id}, function (err, insts) {
                if (err) {
                    return next(err);
                }
                for (var i = 0; i < insts.length; i++) {
                    if (insts[i].name === opts.id) {
                        instFromList = insts[i];
                        // Relying on rule that instance name is unique
                        // for a user and DC.
                        return next();
                    }
                }
                next();
            });
        },

        function tryShortId(_, next) {
            if (inst || instFromList || !shortId) {
                return next();
            }
            var nextOnce = once(next);

            var match;
            var s = self.cloudapi.createListMachinesStream();
            s.on('error', function (err) {
                nextOnce(err);
            });
            s.on('readable', function () {
                var candidate;
                while ((candidate = s.read()) !== null) {
                    if (candidate.id.slice(0, shortId.length) === shortId) {
                        if (match) {
                            return nextOnce(new errors.TritonError(
                                'instance short id "%s" is ambiguous',
                                shortId));
                        } else {
                            match = candidate;
                        }
                    }
                }
            });
            s.on('end', function () {
                if (match) {
                    instFromList = match;
                }
                nextOnce();
            });
        },

        /*
         * There can be fields that only exist on the machine object from
         * GetMachine, and not from ListMachine. `dns_names` is one of these.
         * Therefore, if we got the machine from filtering ListMachine, then
         * we need to re-GetMachine.
         */
        function reGetIfFromList(_, next) {
            if (inst || !instFromList) {
                next();
                return;
            } else if (opts.fields) {
                // If already have all the requested fields, no need to re-get.
                var missingAField = false;
                for (var i = 0; i < opts.fields.length; i++) {
                    if (!instFromList.hasOwnProperty(opts.fields[i])) {
                        missingAField = true;
                        break;
                    }
                }
                if (!missingAField) {
                    inst = instFromList;
                    next();
                    return;
                }
            }

            var uuid = instFromList.id;
            self.cloudapi.getMachine({
                id: uuid,
                credentials: opts.credentials
            }, function onMachine(err, inst_, res_) {
                res = res_;
                inst = inst_;
                err = errFromGetMachineErr(err);
                next(err);
            });
        }
    ]}, function (err) {
        if (err || inst) {
            cb(err, inst, res);
        } else {
            cb(new errors.ResourceNotFoundError(format(
                'no instance with name or short id "%s" was found', opts.id)));
        }
    });
};

// ---- instance console vnc

/**
 * Get VNC connection to the console of an HVM instance.
 * @param {String} id: Required.  The instance UUID, name, or short ID.
 * @param {Function} callback of the form `function (err, shed)`
 */
TritonApi.prototype.getInstanceVnc = function getInstanceVnc(id, cb) {
    assert.string(id, 'id');
    assert.func(cb, 'cb');

    var self = this;
    var shed = null;

    vasync.pipeline({arg: {client: self, id: id}, funcs: [
        _stepInstId,
        function getVncConnection(arg, next) {
            self.cloudapi.getMachineVnc(arg.instId, function (err, shed_, _) {
                if (err) {
                    next(err);
                    return;
                }
                shed = shed_;
                next();
            });
        }
    ]}, function vasyncCb(err) {
        if (err) {
            cb(err, null);
        } else {
            cb(null, shed);
        }
    });
};

// ---- instance enable/disable firewall

/**
 * Enable the firewall on an instance.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance ID, name, or short ID.
 * @param {Function} callback `function (err, fauxInst, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `fauxInst` is an object with just the instance id,
 *      `{id: <instance UUID>}` and `res` is the CloudAPI
 *      `EnableMachineFirewall` response.
 *      The API call does not return the instance/machine object, hence we
 *      are limited to just the id for `fauxInst`.
 */
TritonApi.prototype.enableInstanceFirewall =
function enableInstanceFirewall(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fauxInst;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function enableFirewall(arg, next) {
            fauxInst = {id: arg.instId};

            self.cloudapi.enableMachineFirewall(arg.instId,
                    function (err, _, _res) {
                res = _res;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, fauxInst, res);
    });
};


/**
 * Disable the firewall on an instance.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance ID, name, or short ID.
 * @param {Function} callback `function (err, fauxInst, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `fauxInst` is an object with just the instance id,
 *      `{id: <instance UUID>}` and `res` is the CloudAPI
 *      `EnableMachineFirewall` response.
 *      The API call does not return the instance/machine object, hence we
 *      are limited to just the id for `fauxInst`.
 */
TritonApi.prototype.disableInstanceFirewall =
function disableInstanceFirewall(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fauxInst;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function disableFirewall(arg, next) {
            fauxInst = {id: arg.instId};

            self.cloudapi.disableMachineFirewall(arg.instId,
                    function (err, _, _res) {
                res = _res;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, fauxInst, res);
    });
};


// ---- instance enable/disable deletion protection

/**
 * Enable deletion protection on an instance.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance ID, name, or short ID.
 * @param {Function} callback `function (err, fauxInst, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `fauxInst` is an object with just the instance id,
 *      `{id: <instance UUID>}` and `res` is the CloudAPI
 *      `EnableMachineDeletionProtection` response.
 *      The API call does not return the instance/machine object, hence we
 *      are limited to just the id for `fauxInst`.
 */
TritonApi.prototype.enableInstanceDeletionProtection =
function enableInstanceDeletionProtection(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fauxInst;

    function enableDeletionProtection(arg, next) {
        fauxInst = {id: arg.instId};

        self.cloudapi.enableMachineDeletionProtection(arg.instId,
                function enableCb(err, _, _res) {
            res = _res;
            next(err);
        });
    }

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,
        enableDeletionProtection
    ]}, function vasyncCb(err) {
        cb(err, fauxInst, res);
    });
};


/**
 * Disable deletion protection on an instance.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance ID, name, or short ID.
 * @param {Function} callback `function (err, fauxInst, res)`
 *      On failure `err` is an error instance, else it is null.
 *      On success: `fauxInst` is an object with just the instance id,
 *      `{id: <instance UUID>}` and `res` is the CloudAPI
 *      `DisableMachineDeletionProtectiomn` response.
 *      The API call does not return the instance/machine object, hence we
 *      are limited to just the id for `fauxInst`.
 */
TritonApi.prototype.disableInstanceDeletionProtection =
function disableInstanceDeletionProtection(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fauxInst;

    function disableDeletionProtection(arg, next) {
        fauxInst = {id: arg.instId};

        self.cloudapi.disableMachineDeletionProtection(arg.instId,
                function (err, _, _res) {
            res = _res;
            next(err);
        });
    }

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,
        disableDeletionProtection
    ]}, function vasyncCb(err) {
        cb(err, fauxInst, res);
    });
};


// ---- instance snapshots

/**
 * Create a snapshot of an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} name: The name for new snapshot. Optional.
 * @param {Function} callback `function (err, snapshots, res)`
 */
TritonApi.prototype.createInstanceSnapshot =
function createInstanceSnapshot(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var snapshot;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function createSnapshot(arg, next) {
            self.cloudapi.createMachineSnapshot({
                id: arg.instId,
                name: opts.name
            }, function (err, snap, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                snapshot = snap;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, snapshot, res);
    });
};


/**
 * List an instance's snapshots.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, snapshots, res)`
 */
TritonApi.prototype.listInstanceSnapshots =
function listInstanceSnapshots(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var snapshots;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function listSnapshots(arg, next) {
            self.cloudapi.listMachineSnapshots({
                id: arg.instId,
                name: opts.name
            }, function (err, snaps, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                snapshots = snaps;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, snapshots, res);
    });
};


/**
 * Get an instance's snapshot.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} name: The name of the snapshot. Required.
 * @param {Function} callback `function (err, snapshot, res)`
 */
TritonApi.prototype.getInstanceSnapshot =
function getInstanceSnapshot(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var snapshot;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function getSnapshot(arg, next) {
            self.cloudapi.getMachineSnapshot({
                id: arg.instId,
                name: opts.name
            }, function (err, _snap, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                snapshot = _snap;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, snapshot, res);
    });
};


/**
 * Delete an instance's snapshot.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} name: The name of the snapshot. Required.
 * @param {Function} callback `function (err, res)`
 *
 */
TritonApi.prototype.deleteInstanceSnapshot =
function deleteInstanceSnapshot(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function deleteSnapshot(arg, next) {
            self.cloudapi.deleteMachineSnapshot({
                id: arg.instId,
                name: opts.name
            }, function (err, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};

// ---- instance metadatas

/**
 * Update a metadata of an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Object} metas: The name for new metadata. Required.
 * @param {Function} callback `function (err, metadatas, res)`
 */
TritonApi.prototype.updateInstanceMetadata =
function updateInstanceMetadata(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.object(opts.metas, 'opts.metas');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var metadata;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function updateMetadata(arg, next) {
            self.cloudapi.updateMachineMetadata({
                id: arg.instId,
                metas: opts.metas
            }, function (err, meta, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                metadata = meta;
                next(err);
            });
        },
        function waitForMetadataChanges(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self._waitForInstanceMetadataChanges({
                id: arg.instId,
                timeout: opts.waitTimeout,
                action: 'update'
            }, next);
        }
    ]}, function (err) {
        cb(err, metadata, res);
    });
};

/**
 * List an instance's metadatas
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, snapshots, res)`
 */
TritonApi.prototype.listInstanceMetadatas =
function listInstanceMetadatas(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var metadatas;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function listMetadatas(arg, next) {
            self.cloudapi.listMachineMetadatas({
                id: arg.instId
            }, function (err, datas, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                metadatas = datas;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, metadatas, res);
    });
};

/**
 * Get an instance's metadata
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} name: The name of the metadata. Required.
 * @param {Function} callback `function (err, metadata, res)`
 */
TritonApi.prototype.getInstanceMetadata =
function getInstanceMetadata(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var metadata;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function getMetadata(arg, next) {
            self.cloudapi.getMachineMetadata({
                id: arg.instId,
                name: opts.name
            }, function (err, _meta, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                metadata = _meta;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, metadata, res);
    });
};

/**
 * Delete an instance's metadata.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} key: The key of the metadata. Required.
 * @param {Function} callback `function (err, res)`
 *
 */
TritonApi.prototype.deleteInstanceMetadata =
function deleteInstanceMetadata(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.key, 'opts.key');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function deleteMetadata(arg, next) {
            self.cloudapi.deleteMachineMetadata({
                id: arg.instId,
                key: opts.key
            }, function (err, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                next(err);
            });
        },
        function waitForMetadataChanges(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self._waitForInstanceMetadataChanges({
                id: arg.instId,
                timeout: opts.waitTimeout,
                action: 'delete'
            }, next);
        }

    ]}, function (err) {
        cb(err, res);
    });
};

/**
 * DeleteAll an instance's metadata.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, res)`
 *
 */
TritonApi.prototype.deleteAllInstanceMetadata =
function deleteAllInstanceMetadata(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function deleteAllMetadata(arg, next) {
            self.cloudapi.deleteAllMachineMetadata({
                id: arg.instId
            }, function (err, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                next(err);
            });
        },
        function waitForMetadataChanges(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self._waitForInstanceMetadataChanges({
                id: arg.instId,
                timeout: opts.waitTimeout,
                action: 'deleteAll'
            }, next);
        }

    ]}, function (err) {
        cb(err, res);
    });
};

TritonApi.prototype._waitForInstanceMetadataChanges =
function _waitForInstanceMetadataChanges(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.optionalNumber(opts.timeout, 'opts.timeout');
    var timeout = opts.hasOwnProperty('timeout') ? opts.timeout : Infinity;
    assert.ok(timeout > 0, 'opts.timeout must be greater than zero');
    assert.string(opts.action, 'opts.action');
    assert.func(cb, 'cb');

    /*
     * Hardcoded 2s poll interval for now. Not yet configurable, being mindful
     * of avoiding lots of clients naively swamping a CloudAPI and hitting
     * throttling.
     */
    var POLL_INTERVAL = 2 * 1000;
    var startTime = Date.now();

    var poll = function () {
        self.cloudapi.machineAudit(opts.id, function (err, audit) {
            if (err) {
                cb(err);
                return;
            }
            var incomplete = false;
            var auditAction = audit[0].action;
            var auditTime = audit[0].time;
            var auditSuccess = audit[0].success;

            switch (opts.action) {
                case 'update':
                    if (auditAction === 'set_metadata') {
                        incomplete = true;
                    }
                    break;
                case 'delete':
                    if (auditAction === 'remove_metadata') {
                         incomplete = true;
                    }
                    break;
                case 'deleteAll':
                    if (auditAction === 'replace_metadata') {
                        incomplete = true;
                    }
                    break;
                default:
                    throw new Error('unexpected action: ' + opts.action);
            }
            if (incomplete && auditSuccess &&
                (startTime < Date.parse(auditTime))) {
                cb();
                return;
            } else {
                var elapsedTime = Date.now() - startTime;
                if (elapsedTime > timeout) {
                    cb(new errors.TimeoutError(format('timeout waiting for '
                        + 'instance %s %s (elapsed %ds)',
                        opts.id, opts.action, Math.round(elapsedTime / 1000))));
                } else {
                    setTimeout(poll, POLL_INTERVAL);
                }
            }
        });
    };

    setImmediate(poll);
};

// ---- instance migrations

/**
 * Performs a migration action for a given instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} action: The name for action. Required.
 * @param {Function} callback `function (err, migration, res)`
 */
TritonApi.prototype.doInstanceMigration =
function doInstanceMigration(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.action, 'opts.action');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var migration;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function doMigration(arg, next) {
            self.cloudapi.machineMigration({
                id: arg.instId,
                action: opts.action
            }, function (err, migr, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                migration = migr;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, migration, res);
    });
};


/**
 * List an account migrations.
 *
 * @param {Function} callback `function (err, migrations, res)`
 */
TritonApi.prototype.listMigrations =
function listMigrations(opts, cb) {
    assert.func(cb, 'cb');
    this.cloudapi.listMigrations(cb);
};


/**
 * Get instance migration
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, migration, res)`
 */
TritonApi.prototype.getMigration =
function getMigration(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var self = this;
    var res;
    var migration;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,
        function _getMigr(arg, next) {
            self.cloudapi.getMigration({
                id: arg.instId
            }, function getMigrCb(err, migr, _res) {
                    res = _res;
                    // gross hack, in case caller needs it:
                    res.instId = arg.instId;
                    migration = migr;
                    next(err);
                });
        }
    ]}, function (pipeErr) {
        cb(pipeErr, migration, res);
    });
};



// ---- instance tags

/**
 * List an instance's tags.
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListMachineTags>
 *
 * Alternative call signature: `listInstanceTags(id, callback)`.
 *
 * @param {Object} opts
 *      - {UUID} id: The instance ID, name, or short ID. Required.
 * @param {Function} cb: `function (err, tags, res)`
 *      On success, `res` is *possibly* the response object from either a
 *      `ListMachineTags` or a `GetMachine` call.
 */
TritonApi.prototype.listInstanceTags = function listInstanceTags(opts, cb) {
    var self = this;
    if (typeof (opts) === 'string') {
        opts = {id: opts};
    }
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    if (common.isUUID(opts.id)) {
        self.cloudapi.listMachineTags(opts, cb);
        return;
    }

    self.getInstance({
        id: opts.id,
        fields: ['id', 'tags']
    }, function (err, inst, res) {
        if (err) {
            cb(err);
            return;
        }
        // No need to call `ListMachineTags` now.
        cb(null, inst.tags, res);
    });
};


/**
 * Get an instance tag value.
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetMachineTag>
 *
 * @param {Object} opts
 *      - {UUID} id: The instance ID, name, or short ID. Required.
 *      - {String} tag: The tag name. Required.
 * @param {Function} cb: `function (err, value, res)`
 *      On success, `value` is the tag value *as a string*. See note above.
 *      On success, `res` is *possibly* the response object from either a
 *      `GetMachineTag` or a `GetMachine` call.
 */
TritonApi.prototype.getInstanceTag = function getInstanceTag(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.string(opts.tag, 'opts.tag');
    assert.func(cb, 'cb');

    if (common.isUUID(opts.id)) {
        self.cloudapi.getMachineTag(opts, cb);
        return;
    }

    self.getInstance({
        id: opts.id,
        fields: ['id', 'tags']
    }, function (err, inst, res) {
        if (err) {
            cb(err);
            return;
        }
        // No need to call `GetMachineTag` now.
        if (inst.tags.hasOwnProperty(opts.tag)) {
            var value = inst.tags[opts.tag];
            cb(null, value, res);
        } else {
            cb(new errors.ResourceNotFoundError(format(
                'tag with name "%s" was not found', opts.tag)));
        }
    });
};


/**
 * Shared implementation for any methods to change instance tags.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Object} change: Required. Describes the tag change to make. It
 *        has an "action" field and, depending on the particular action, a
 *        "tags" field.
 *      - {Boolean} wait: Wait (via polling) until the tag update is complete.
 *        Warning: A concurrent tag update to the same tags can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err, tags, res)`
 *      On success, `tags` is the updated set of instance tags and `res` is
 *      the response object from the underlying CloudAPI call. Note that `tags`
 *      is not set (undefined) for the "delete" and "deleteAll" actions.
 */
TritonApi.prototype._changeInstanceTags =
function _changeInstanceTags(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.object(opts.change, 'opts.change');
    var KNOWN_CHANGE_ACTIONS = ['set', 'replace', 'delete', 'deleteAll'];
    assert.ok(KNOWN_CHANGE_ACTIONS.indexOf(opts.change.action) != -1,
        'invalid change action: ' + opts.change.action);
    switch (opts.change.action) {
    case 'set':
    case 'replace':
        assert.object(opts.change.tags,
            'opts.change.tags for action=' + opts.change.action);
        break;
    case 'delete':
        assert.string(opts.change.tagName,
            'opts.change.tagName for action=delete');
        break;
    case 'deleteAll':
        break;
    default:
        throw new Error('unexpected action: ' + opts.change.action);
    }
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var theRes;
    var updatedTags;
    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function changeTheTags(arg, next) {
            switch (opts.change.action) {
            case 'set':
                self.cloudapi.addMachineTags({
                    id: arg.instId,
                    tags: opts.change.tags
                }, function (err, tags, res) {
                    updatedTags = tags;
                    theRes = res;
                    next(err);
                });
                break;
            case 'replace':
                self.cloudapi.replaceMachineTags({
                    id: arg.instId,
                    tags: opts.change.tags
                }, function (err, tags, res) {
                    updatedTags = tags;
                    theRes = res;
                    next(err);
                });
                break;
            case 'delete':
                self.cloudapi.deleteMachineTag({
                    id: arg.instId,
                    tag: opts.change.tagName
                }, function (err, res) {
                    theRes = res;
                    next(err);
                });
                break;
            case 'deleteAll':
                self.cloudapi.deleteMachineTags({
                    id: arg.instId
                }, function (err, res) {
                    theRes = res;
                    next(err);
                });
                break;
            default:
                throw new Error('unexpected action: ' + opts.change.action);
            }
        },

        function waitForChanges(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self.waitForInstanceTagChanges({
                id: arg.instId,
                timeout: opts.waitTimeout,
                change: opts.change
            }, next);
        }
    ]}, function (err) {
        if (err) {
            cb(err);
        } else {
            cb(null, updatedTags, theRes);
        }
    });
};


/**
 * Wait (via polling) for the given tag changes to have taken on the instance.
 *
 * Dev Note: This polls `ListMachineTags` until it looks like the given changes
 * have been applied. This is unreliable with concurrent tag updates. A
 * workaround for that is `opts.timeout`. A better long term solution would
 * be for cloudapi to expose some handle on the underlying Triton workflow
 * jobs performing these, and poll/wait on those.
 *
 * @param {Object} opts: Required.
 *      - {UUID} id: Required. The instance id.
 *        Limitation: Currently requiring this to be the full instance UUID.
 *      - {Number} timeout: Optional. A number of milliseconds after which to
 *        timeout (callback with `TimeoutError`) the wait. By default this is
 *        Infinity.
 *      - {Object} changes: Required. It always has an 'action' field (one of
 *        'set', 'replace', 'delete', 'deleteAll') and, depending on the
 *        action, a 'tags' (set, replace), 'tagName' (delete) or 'tagNames'
 *        (delete).
 * @param {Function} cb: `function (err, updatedTags)`
 *      On failure, `err` can be an error from `ListMachineTags` or
 *      `TimeoutError`.
 */
TritonApi.prototype.waitForInstanceTagChanges =
function waitForInstanceTagChanges(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.optionalNumber(opts.timeout, 'opts.timeout');
    var timeout = opts.hasOwnProperty('timeout') ? opts.timeout : Infinity;
    assert.ok(timeout > 0, 'opts.timeout must be greater than zero');
    assert.object(opts.change, 'opts.change');
    var KNOWN_CHANGE_ACTIONS = ['set', 'replace', 'delete', 'deleteAll'];
    assert.ok(KNOWN_CHANGE_ACTIONS.indexOf(opts.change.action) != -1,
        'invalid change action: ' + opts.change.action);
    assert.func(cb, 'cb');

    var tagNames;
    switch (opts.change.action) {
    case 'set':
    case 'replace':
        assert.object(opts.change.tags, 'opts.change.tags');
        break;
    case 'delete':
        if (opts.change.tagNames) {
            assert.arrayOfString(opts.change.tagNames, 'opts.change.tagNames');
            tagNames = opts.change.tagNames;
        } else {
            assert.string(opts.change.tagName, 'opts.change.tagName');
            tagNames = [opts.change.tagName];
        }
        break;
        case 'deleteAll':
            break;
        default:
            throw new Error('unexpected action: ' + opts.change.action);
    }

    /*
     * Hardcoded 2s poll interval for now. Not yet configurable, being mindful
     * of avoiding lots of clients naively swamping a CloudAPI and hitting
     * throttling.
     * TODO: General client support for dealing with polling and throttling.
     */
    var POLL_INTERVAL = 2 * 1000;

    var startTime = Date.now();

    var poll = function () {
        self.log.trace({id: opts.id}, 'waitForInstanceTagChanges: poll inst');
        self.cloudapi.listMachineTags({id: opts.id}, function (err, tags) {
            if (err) {
                cb(err);
                return;
            }

            // Determine in changes are not yet applied (incomplete).
            var incomplete = false;
            var i, k, keys;
            switch (opts.change.action) {
            case 'set':
                keys = Object.keys(opts.change.tags);
                for (i = 0; i < keys.length; i++) {
                    k = keys[i];
                    if (tags[k] !== opts.change.tags[k]) {
                        self.log.trace({tag: k},
                            'waitForInstanceTagChanges incomplete set: '
                            + 'unexpected value for tag');
                        incomplete = true;
                        break;
                    }
                }
                break;
            case 'replace':
                keys = Object.keys(opts.change.tags);
                var tagsCopy = common.objCopy(tags);
                for (i = 0; i < keys.length; i++) {
                    k = keys[i];
                    if (tagsCopy[k] !== opts.change.tags[k]) {
                        self.log.trace({tag: k},
                            'waitForInstanceTagChanges incomplete replace: '
                            + 'unexpected value for tag');
                        incomplete = true;
                        break;
                    }
                    delete tagsCopy[k];
                }
                var extraneousTags = Object.keys(tagsCopy);
                if (extraneousTags.length > 0) {
                    self.log.trace({extraneousTags: extraneousTags},
                        'waitForInstanceTagChanges incomplete replace: '
                        + 'extraneous tags');
                    incomplete = true;
                }
                break;
            case 'delete':
                for (i = 0; i < tagNames.length; i++) {
                    k = tagNames[i];
                    if (tags.hasOwnProperty(k)) {
                        self.log.trace({tag: k},
                            'waitForInstanceTagChanges incomplete delete: '
                            + 'extraneous tag');
                        incomplete = true;
                        break;
                    }
                }
                break;
            case 'deleteAll':
                if (Object.keys(tags).length > 0) {
                    self.log.trace({tag: k},
                        'waitForInstanceTagChanges incomplete deleteAll: '
                        + 'still have tags');
                    incomplete = true;
                }
                break;
            default:
                throw new Error('unexpected action: ' + opts.change.action);
            }

            if (!incomplete) {
                self.log.trace('waitForInstanceTagChanges: complete');
                cb(null, tags);
            } else {
                var elapsedTime = Date.now() - startTime;
                if (elapsedTime > timeout) {
                    cb(new errors.TimeoutError(format('timeout waiting for '
                        + 'tag changes on instance %s (elapsed %ds)',
                        opts.id, Math.round(elapsedTime / 1000))));
                } else {
                    setTimeout(poll, POLL_INTERVAL);
                }
            }
        });
    };

    setImmediate(poll);
};


/**
 * Set instance tags.
 * <http://apidocs.tritondatacenter.com/cloudapi/#AddMachineTags>
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Object} tags: The tag name/value pairs. Required.
 *      - {Boolean} wait: Wait (via polling) until the tag update is complete.
 *        Warning: A concurrent tag update to the same tags can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err, updatedTags, res)`
 *      On success, `updatedTags` is the updated set of instance tags and `res`
 *      is the response object from the `AddMachineTags` CloudAPI call.
 */
TritonApi.prototype.setInstanceTags = function setInstanceTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.object(opts.tags, 'opts.tags');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    this._changeInstanceTags({
        id: opts.id,
        change: {
            action: 'set',
            tags: opts.tags
        },
        wait: opts.wait,
        waitTimeout: opts.waitTimeout
    }, cb);
};


/**
 * Replace all instance tags.
 * <http://apidocs.tritondatacenter.com/cloudapi/#ReplaceMachineTags>
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Object} tags: The tag name/value pairs. Required.
 *      - {Boolean} wait: Wait (via polling) until the tag update is complete.
 *        Warning: A concurrent tag update to the same tags can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err, tags, res)`
 *      On success, `tags` is the updated set of instance tags and `res` is
 *      the response object from the `ReplaceMachineTags` CloudAPI call.
 */
TritonApi.prototype.replaceAllInstanceTags =
function replaceAllInstanceTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.object(opts.tags, 'opts.tags');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    this._changeInstanceTags({
        id: opts.id,
        change: {
            action: 'replace',
            tags: opts.tags
        },
        wait: opts.wait,
        waitTimeout: opts.waitTimeout
    }, cb);
};


/**
 * Delete the named instance tag.
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteMachineTag>
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} tag: The tag name. Required.
 *      - {Boolean} wait: Wait (via polling) until the tag update is complete.
 *        Warning: A concurrent tag update to the same tags can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err, res)`
 */
TritonApi.prototype.deleteInstanceTag = function deleteInstanceTag(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.string(opts.tag, 'opts.tag');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    this._changeInstanceTags({
        id: opts.id,
        change: {
            action: 'delete',
            tagName: opts.tag
        },
        wait: opts.wait,
        waitTimeout: opts.waitTimeout
    }, function (err, updatedTags, res) {
        cb(err, res);
    });
};


/**
 * Delete all tags for the given instance.
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteMachineTags>
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Boolean} wait: Wait (via polling) until the tag update is complete.
 *        Warning: A concurrent tag update to the same tags can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err, res)`
 */
TritonApi.prototype.deleteAllInstanceTags =
function deleteAllInstanceTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    this._changeInstanceTags({
        id: opts.id,
        change: {
            action: 'deleteAll'
        },
        wait: opts.wait,
        waitTimeout: opts.waitTimeout
    }, function (err, updatedTags, res) {
        cb(err, res);
    });
};


// ---- nics

/**
 * Add a NIC on a network to an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Object|String} network: The network object or ID, name, or short ID.
 *          Required.
 * @param {Function} callback `function (err, nic, res)`
 */
TritonApi.prototype.addNic =
function addNic(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.ok(opts.network, 'opts.network');
    assert.func(cb, 'cb');

    var self = this;
    var nic;
    var pipeline = [];
    var res;

    switch (typeof (opts.network)) {
    case 'string':
        pipeline.push(_stepNetId);
        break;
    case 'object':
        break;
    default:
        throw new Error('unexpected opts.network: ' + opts.network);
    }

    pipeline.push(_stepInstId);
    pipeline.push(function createNic(arg, next) {
        self.cloudapi.addNic({
            id: arg.instId,
            network: arg.netId || arg.network,
            primary: arg.primary
        }, function onCreateNic(err, _nic, _res) {
            res = _res;
            res.instId = arg.instId; // gross hack, in case caller needs it
            res.netId = arg.netId;   // ditto
            nic = _nic;
            next(err);
        });
    });

    var pipelineArg = {
        client: self,
        id: opts.id,
        network: opts.network,
        primary: opts.primary
    };

    vasync.pipeline({
        arg: pipelineArg,
        funcs: pipeline
    }, function (err) {
        cb(err, nic, res);
    });
};


/**
 * List an instance's NICs.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, nics, res)`
 */
TritonApi.prototype.listNics =
function listNics(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var nics;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function list(arg, next) {
            self.cloudapi.listNics({
                id: arg.instId
            }, function onList(err, _nics, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                nics = _nics;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, nics, res);
    });
};


/**
 * Get a NIC belonging to an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} mac: The NIC's MAC address. Required.
 * @param {Function} callback `function (err, nic, res)`
 */
TritonApi.prototype.getNic =
function getNic(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.mac, 'opts.mac');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var nic;

    vasync.pipeline({arg: {client: self, id: opts.id, mac: opts.mac}, funcs: [
        _stepInstId,

        function get(arg, next) {
            self.cloudapi.getNic({
                id: arg.instId,
                mac: arg.mac
            }, function onGet(err, _nic, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                nic = _nic;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, nic, res);
    });
};


/**
 * Remove a NIC from an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} mac: The NIC's MAC address. Required.
 * @param {Function} callback `function (err, res)`
 *
 */
TritonApi.prototype.removeNic =
function removeNic(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.mac, 'opts.mac');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id, mac: opts.mac}, funcs: [
        _stepInstId,

        function deleteNic(arg, next) {
            self.cloudapi.removeNic({
                id: arg.instId,
                mac: arg.mac
            }, function onRemove(err, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};


/**
 * Wrapper for cloudapi2's waitForNicStates that will first translate
 * opts.id into the proper uuid from shortid/name.
 *
 * @param {Object} options
 *      - {String} id {required} machine id
 *      - {String} mac {required} mac for new nic
 *      - {Array of String} states - desired state
 * @param {Function} callback of the form f(err, nic, res).
 */
TritonApi.prototype.waitForNicStates = function waitForNicStates(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.string(opts.mac, 'opts.mac');
    assert.arrayOfString(opts.states, 'opts.states');

    var self = this;
    var nic, res;

    function waitForNic(arg, next) {
        var _opts = {
            id: arg.instId,
            mac: arg.mac,
            states: arg.states
        };

        self.cloudapi.waitForNicStates(_opts,
            function onWaitForNicState(err, _nic, _res) {
            res = _res;
            nic = _nic;
            next(err);
        });
    }

    var pipelineArgs = {
        client: self,
        id: opts.id,
        mac: opts.mac,
        states: opts.states
    };

    vasync.pipeline({
        arg: pipelineArgs,
        funcs: [
            _stepInstId,
            waitForNic
        ]
    }, function onWaitForNicPipeline(err) {
        cb(err, nic, res);
    });
};


// ---- Firewall Rules

/**
 * Get a firewall rule by ID, or short ID, in that order.
 *
 * If there is more than one firewall rule with that short ID, then this errors
 * out.
 */
TritonApi.prototype.getFirewallRule = function getFirewallRule(id, cb) {
    assert.string(id, 'id');
    assert.func(cb, 'cb');

    if (common.isUUID(id)) {
        this.cloudapi.getFirewallRule(id, function (err, fwrule) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    err = new errors.ResourceNotFoundError(err,
                        format('firewall rule with id %s was not found', id));
                }
                cb(err);
            } else {
                cb(null, fwrule);
            }
        });
    } else {
        this.cloudapi.listFirewallRules({}, function (err, fwrules) {
            if (err) {
                cb(err);
                return;
            }

            var shortIdMatches = fwrules.filter(function (fwrule) {
                return fwrule.id.slice(0, 8) === id;
            });

            if (shortIdMatches.length === 1) {
                cb(null, shortIdMatches[0]);
            } else if (shortIdMatches.length === 0) {
                cb(new errors.ResourceNotFoundError(format(
                    'no firewall rule with short id "%s" was found', id)));
            } else {
                cb(new errors.ResourceNotFoundError(
                    format('"%s" is an ambiguous short id, with multiple ' +
                           'matching firewall rules', id)));
            }
        });
    }
};


/**
 * List all firewall rules affecting an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, instances, res)`
 */
TritonApi.prototype.listInstanceFirewallRules =
function listInstanceFirewallRules(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fwrules;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function listRules(arg, next) {
            self.cloudapi.listMachineFirewallRules({
                id: arg.instId
            }, function (err, rules, _res) {
                res = _res;
                fwrules = rules;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, fwrules, res);
    });
};


/**
 * List all instances affected by a firewall rule.
 *
 * @param {Object} opts
 *      - {String} id: The fwrule ID, or short ID. Required.
 * @param {Function} callback `function (err, instances, res)`
 */
TritonApi.prototype.listFirewallRuleInstances =
function listFirewallRuleInstances(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var instances;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepFwRuleId,

        function listInsts(arg, next) {
            self.cloudapi.listFirewallRuleMachines({
                id: arg.fwruleId
            }, function (err, machines, _res) {
                res = _res;
                instances = machines;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, instances, res);
    });
};


/**
 * Update a firewall rule.
 *
 * Dev Note: Currently cloudapi UpdateFirewallRule *requires* the 'rule' field,
 * which is overkill. `TritonApi.updateFirewallRule` adds sugar by making
 * 'rule' optional.
 *
 * @param {Object} opts
 *      - {String} id: The fwrule ID, or short ID. Required.
 *      - {String} rule: The fwrule text. Optional.
 *      - {Boolean} enabled: Default to false. Optional.
 *      - {Boolean} log: Default to false. Optional.
 *      - {String} description: Description of the rule. Optional.
 *      At least one of the fields must be provided.
 * @param {Function} callback `function (err, fwrule, res)`
 */
TritonApi.prototype.updateFirewallRule = function updateFirewallRule(opts, cb) {
    // TODO: strict opts field validation
    assert.string(opts.id, 'opts.id');
    assert.optionalString(opts.rule, 'opts.rule');
    assert.optionalBool(opts.enabled, 'opts.enabled');
    assert.optionalBool(opts.log, 'opts.log');
    assert.optionalString(opts.description, 'opts.description');
    assert.ok(opts.rule !== undefined || opts.enabled !== undefined ||
        opts.description !== undefined || opts.log !== undefined,
        'at least one of opts.rule, opts.enabled, opts.log or ' +
        'opts.description is required');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var updatedFwrule;
    var updateOpts = common.objCopy(opts);

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepFwRuleId,

        /*
         * CloudAPI currently requires the 'rule' field. We provide sugar here
         * and fill it in for you.
         */
        function sugarFillRuleField(arg, next) {
            if (updateOpts.rule) {
                next();
            } else if (arg.fwrule) {
                updateOpts.rule = arg.fwrule.rule;
                next();
            } else {
                self.getFirewallRule(arg.fwruleId, function (err, fwrule) {
                    if (err) {
                        next(err);
                    } else {
                        updateOpts.rule = fwrule.rule;
                        next();
                    }
                });
            }
        },

        function updateRule(arg, next) {
            updateOpts.id = arg.fwruleId;
            self.cloudapi.updateFirewallRule(updateOpts,
                    function (err, fwrule, res_) {
                res = res_;
                updatedFwrule = fwrule;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, updatedFwrule, res);
    });
};


/**
 * Enable a firewall rule.
 *
 * @param {Object} opts
 *      - {String} id: The fwrule ID, or short ID. Required.
 * @param {Function} callback `function (err, fwrule, res)`
 */
TritonApi.prototype.enableFirewallRule = function enableFirewallRule(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fwrule;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepFwRuleId,

        function enableRule(arg, next) {
            self.cloudapi.enableFirewallRule({
                id: arg.fwruleId
            }, function (err, rule, _res) {
                res = _res;
                fwrule = rule;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, fwrule, res);
    });
};


/**
 * Disable a firewall rule.
 *
 * @param {Object} opts
 *      - {String} id: The fwrule ID, or short ID. Required.
 * @param {Function} callback `function (err, fwrule, res)`
 */
TritonApi.prototype.disableFirewallRule =
function disableFirewallRule(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var fwrule;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepFwRuleId,

        function disableRule(arg, next) {
            self.cloudapi.disableFirewallRule({
                id: arg.fwruleId
            }, function (err, rule, _res) {
                res = _res;
                fwrule = rule;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, fwrule, res);
    });
};


/**
 * Delete a firewall rule.
 *
 * @param {Object} opts
 *      - {String} id: The fwrule ID, or short ID. Required.
 * @param {Function} callback `function (err, res)`
 *
 */
TritonApi.prototype.deleteFirewallRule = function deleteFirewallRule(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepFwRuleId,

        function deleteRule(arg, next) {
            self.cloudapi.deleteFirewallRule({
                id: arg.fwruleId
            }, function (err, _res) {
                res = _res;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};


// ---- VLANs

/**
 * Get a VLAN by ID or exact name, in that order.
 *
 * If the name is ambiguous, then this errors out.
 */
TritonApi.prototype.getFabricVlan = function getFabricVlan(name, cb) {
    assert.ok(typeof (name) === 'string' ||
              typeof (name) === 'number', 'name');
    assert.func(cb, 'cb');

    if (+name >= 0 && +name < 4096) {
        this.cloudapi.getFabricVlan({vlan_id: +name}, function on(err, vlan) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    // Wrap with our own ResourceNotFound for exitStatus=3.
                    err = new errors.ResourceNotFoundError(err,
                        format('vlan with id %s was not found', name));
                }
                cb(err);
            } else {
                cb(null, vlan);
            }
        });
    } else {
        this.cloudapi.listFabricVlans({}, function onList(err, vlans) {
            if (err) {
                return cb(err);
            }

            var nameMatches = [];
            for (var i = 0; i < vlans.length; i++) {
                var vlan = vlans[i];
                if (vlan.name === name) {
                    nameMatches.push(vlan);
                }
            }

            if (nameMatches.length === 1) {
                cb(null, nameMatches[0]);
            } else if (nameMatches.length > 1) {
                cb(new errors.TritonError(format(
                    'vlan name "%s" is ambiguous: matches %d vlans',
                    name, nameMatches.length)));
            } else {
                cb(new errors.ResourceNotFoundError(format(
                    'no vlan with name "%s" was found', name)));
            }
        });
    }
};


/**
 * Delete a VLAN by ID or exact name, in that order.
 *
 * If the name is ambiguous, then this errors out.
 */
TritonApi.prototype.deleteFabricVlan = function deleteFabricVlan(opts, cb) {
    assert.object(opts, 'opts');
    assert.ok(typeof (opts.vlan_id) === 'string' ||
              typeof (opts.vlan_id) === 'number', 'opts.vlan_id');
    assert.func(cb, 'cb');

    var self = this;
    var vlanId = opts.vlan_id;

    if (+vlanId >= 0 && +vlanId < 4096) {
        deleteVlan(+vlanId);
    } else {
        self.getFabricVlan(vlanId, function onGet(err, vlan) {
            if (err) {
                cb(err);
                return;
            }

            deleteVlan(vlan.vlan_id);
        });
    }

    function deleteVlan(id) {
        self.cloudapi.deleteFabricVlan({vlan_id: id}, cb);
    }
};


// ---- RBAC

/**
 * Get role tags for a resource.
 *
 * @param {Object} opts
 *      - resourceType {String} One of:
 *              resource (a raw RBAC resource URL)
 *              instance
 *              image
 *              package
 *              network
 *      - id {String} The resource identifier. E.g. for an instance this can be
 *        the ID (a UUID), login or short id. Whatever `triton` typically allows
 *        for identification.
 * @param {Function} callback `function (err, roleTags, resource)`
 */
TritonApi.prototype.getRoleTags = function getRoleTags(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    _assertRoleTagResourceType(opts.resourceType, 'opts.resourceType');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    function roleTagsFromRes(res) {
        return (
            (res.headers['role-tag'] || '')
            /* JSSTYLED */
            .split(/\s*,\s*/)
            .filter(function (r) { return r.trim(); })
        );
    }


    var roleTags;
    var resource;

    vasync.pipeline({arg: {}, funcs: [
        function resolveResourceId(ctx, next) {
            if (opts.resourceType === 'resource') {
                next();
                return;
            }

            var getFuncName = {
                instance: 'getInstance',
                image: 'getImage',
                'package': 'getPackage',
                network: 'getNetwork'
            }[opts.resourceType];
            self[getFuncName](opts.id, function (err, resource_, res) {
                if (err) {
                    next(err);
                    return;
                }
                resource = resource_;

                /*
                 * Sometimes `getInstance` et al return a CloudAPI `GetMachine`
                 * res on which there is a 'role-tag' header that we want.
                 */
                if (res) {
                    roleTags = roleTagsFromRes(res);
                }
                next();
            });
        },
        function getResourceIfNecessary(ctx, next) {
            if (roleTags) {
                next();
                return;
            }

            var resourceUrl = (opts.resourceType === 'resource'
                ? opts.id
                : _roleTagResourceUrl(self.profile.account,
                    opts.resourceType, resource.id));
            self.cloudapi.getRoleTags({resource: resourceUrl},
                    function (err, roleTags_, resource_) {
                if (err) {
                    next(err);
                    return;
                }
                roleTags = roleTags_;
                resource = resource_;
                next();
            });
        }
    ]}, function (err) {
        cb(err, roleTags, resource);
    });
};


/**
 * Set role tags for a resource.
 *
 * @param {Object} opts
 *      - resourceType {String} One of:
 *              resource (a raw RBAC resource URL)
 *              instance
 *              image
 *              package
 *              network
 *      - id {String} The resource identifier. E.g. for an instance this can be
 *        the ID (a UUID), login or short id. Whatever `triton` typically allows
 *        for identification.
 *      - roleTags {Array}
 * @param {Function} callback `function (err)`
 */
TritonApi.prototype.setRoleTags = function setRoleTags(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    _assertRoleTagResourceType(opts.resourceType, 'opts.resourceType');
    assert.string(opts.id, 'opts.id');
    assert.arrayOfString(opts.roleTags, 'opts.roleTags');
    assert.func(cb, 'cb');

    vasync.pipeline({arg: {}, funcs: [
        function resolveResourceId(ctx, next) {
            if (opts.resourceType === 'resource') {
                next();
                return;
            }

            var getFuncName = {
                instance: 'getInstance',
                image: 'getImage',
                'package': 'getPackage',
                network: 'getNetwork'
            }[opts.resourceType];
            self[getFuncName](opts.id, function (err, resource, res) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.resource = resource;
                next();
            });
        },

        function setTheRoleTags(ctx, next) {
            var resourceUrl = (opts.resourceType === 'resource'
                ? opts.id
                : _roleTagResourceUrl(self.profile.account,
                    opts.resourceType, ctx.resource.id));
            self.cloudapi.setRoleTags({
                resource: resourceUrl,
                roleTags: opts.roleTags
            }, function (err) {
                if (err) {
                    next(err);
                    return;
                }
                next();
            });
        }
    ]}, function (err) {
        cb(err);
    });
};


/**
 * Get an RBAC user by ID or login.
 *
 * @param {Object} opts
 *      - id {UUID|String} The user ID (a UUID) or login.
 *      - roles {Boolean} Optional. Whether to includes roles of which this
 *        user is a member. Default false.
 *      - keys {Boolean} Optional. Set to `true` to also (with a separate
 *        request) retrieve the `keys` for this user. Default is false.
 * @param {Function} callback of the form `function (err, user)`
 */
TritonApi.prototype.getUser = function getUser(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.roles, 'opts.roles');
    assert.optionalBool(opts.keys, 'opts.keys');
    assert.func(cb, 'cb');

    var context = {};
    vasync.pipeline({arg: context, funcs: [
        function tryGetUser(ctx, next) {
            var getOpts = {
                id: opts.id,
                membership: opts.roles
            };
            self.cloudapi.getUser(getOpts, function (err, user) {
                if (err) {
                    if (err.restCode === 'ResourceNotFound') {
                        // TODO: feels like overkill to wrap this, ensure
                        //      decent cloudapi error for this, then don't wrap.
                        next(new errors.ResourceNotFoundError(err,
                            format('user with login or id "%s" was not found',
                                opts.id)));
                    } else {
                        next(err);
                    }
                } else {
                    ctx.user = user;
                    next();
                }
            });
        },

        function getKeys(ctx, next) {
            if (!opts.keys) {
                next();
                return;
            }
            self.cloudapi.listUserKeys({userId: ctx.user.id},
                    function (err, keys) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.user.keys = keys;
                next();
            });
        }

    ]}, function (err) {
        cb(err, context.user);
    });
};


/**
 * Delete an RBAC role by ID or name.
 *
 * @param {Object} opts
 *      - id {UUID|String} The role id (a UUID) or name.
 * @param {Function} callback of the form `function (err)`
 */
TritonApi.prototype.deleteRole = function deleteRole(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    /*
     * CloudAPI DeleteRole only accepts a role id (UUID).
     */
    var context = {};
    vasync.pipeline({arg: context, funcs: [
        function getId(ctx, next) {
            if (common.isUUID(opts.id)) {
                ctx.id = opts.id;
                next();
                return;
            }

            self.cloudapi.getRole({id: opts.id}, function (err, role) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.id = role.id;
                next();
            });
        },

        function deleteIt(ctx, next) {
            self.cloudapi.deleteRole({id: ctx.id}, next);
        }
    ]}, function (err) {
        cb(err);
    });
};


/**
 * Delete an RBAC policy by ID or name.
 *
 * @param {Object} opts
 *      - id {UUID|String} The policy id (a UUID) or name.
 * @param {Function} callback of the form `function (err)`
 */
TritonApi.prototype.deletePolicy = function deletePolicy(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    /*
     * CloudAPI DeletePolicy only accepts a policy id (UUID).
     */
    var context = {};
    vasync.pipeline({arg: context, funcs: [
        function getId(ctx, next) {
            if (common.isUUID(opts.id)) {
                ctx.id = opts.id;
                next();
                return;
            }

            self.cloudapi.getPolicy({id: opts.id}, function (err, policy) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.id = policy.id;
                next();
            });
        },

        function deleteIt(ctx, next) {
            self.cloudapi.deletePolicy({id: ctx.id}, next);
        }
    ]}, function (err) {
        cb(err);
    });
};


/**
 * Reboot an instance by id.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance name, short id, or id (a UUID).
 *      - {Boolean} wait: Wait (via polling) until the reboot is complete.
 *        Warning: Time skew (between the cloudapi server and the CN on
 *        which the instance resides) or a concurrent reboot can result in this
 *        polling being unable to notice the change properly. Use `waitTimeout`
 *        to put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} callback of the form `function (err, _, res)`
 *
 * Dev Note: This polls on MachineAudit... which might be heavy on TritonDC's
 * currently implementation of that. PUBAPI-1347 is a better solution.
 */
TritonApi.prototype.rebootInstance = function rebootInstance(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    function randrange(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function rebootIt(arg, next) {
            self.cloudapi.rebootMachine(arg.instId, function (err, _, _res) {
                res = _res;
                next(err);
            });
        },

        function waitForIt(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }

            /*
             * Polling on the instance `state` doesn't work for a reboot,
             * because a first poll value of "running" is ambiguous: was it
             * a fast reboot, or has the instance not yet left the running
             * state?
             *
             * Lacking PUBAPI-1347, we'll use the MachineAudit endpoint to
             * watch for a 'reboot' action that finished after the server time
             * for the RebootMachine response (i.e. the "Date" header), e.g.:
             *      date: Wed, 08 Feb 2017 20:55:35 GMT
             * Example reboot audit entry:
             *      {"success":"yes",
             *       "time":"2017-02-08T20:55:44.045Z",
             *       "action":"reboot",
             *       ...}
             *
             * Hardcoded 2s poll interval for now (randomized for the first
             * poll). Not yet configurable, being mindful of avoiding lots of
             * clients naively swamping a CloudAPI and hitting throttling.
             */
            var POLL_INTERVAL = 2 * 1000;
            var startTime = process.hrtime();
            var dateHeader = res.headers['date'];
            var resTime = Date.parse(dateHeader);
            if (!dateHeader) {
                next(new errors.InternalError(format(
                    'cannot wait for reboot: CloudAPI RebootMachine response '
                    + 'did not include a "Date" header (req %s)',
                    res.headers['request-id'])));
                return;
            } else if (isNaN(resTime)) {
                next(new errors.InternalError(format(
                    'cannot wait for reboot: could not parse CloudAPI '
                    + 'RebootMachine response "Date" header: "%s" (req %s)',
                    dateHeader, res.headers['request-id'])));
                return;
            }
            self.log.trace({id: arg.instId, resTime: resTime},
                'wait for reboot audit record');

            var pollMachineAudit = function () {
                self.cloudapi.machineAudit(arg.instId, function (aErr, audit) {
                    if (aErr) {
                        next(aErr);
                        return;
                    }

                    /*
                     * Search the top few audit records, in case some other
                     * action slipped in.
                     */
                    var theRecord = null;
                    for (var i = 0; i < audit.length; i++) {
                        if (audit[i].action === 'reboot' &&
                            Date.parse(audit[i].time) > resTime) {
                            theRecord = audit[i];
                            break;
                        }
                    }

                    if (!theRecord) {
                        if (opts.waitTimeout) {
                            var elapsedMs =
                                common.monotonicTimeDiffMs(startTime);
                            if (elapsedMs > opts.waitTimeout) {
                                next(new errors.TimeoutError(format('timeout '
                                    + 'waiting for instance %s reboot '
                                    + '(elapsed %ds)',
                                    arg.instId,
                                    Math.round(elapsedMs / 1000))));
                                return;
                            }
                        }
                        setTimeout(pollMachineAudit, POLL_INTERVAL);
                    } else if (theRecord.success !== 'yes') {
                        next(new errors.TritonError(format(
                            'reboot failed (audit id %s)', theRecord.id)));
                    } else {
                        next();
                    }
                });
            };

            /*
             * Add a random start delay to avoid a number of concurrent reboots
             * all polling at the same time.
             */
            setTimeout(pollMachineAudit,
                (POLL_INTERVAL / 2) + randrange(0, POLL_INTERVAL));
        }
    ]}, function (err) {
        cb(err, null, res);
    });
};


/**
 * Resize a machine by id.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance name, short id, or id (a UUID).
 *      - {String} package: Required. The new package name, shortId,
 *        or id (a UUID).
 *      - {Boolean} wait: Wait (via polling) until the rename is complete.
 *        Warning: A concurrent resize of the same instance can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} callback of the form `function (err, _, res)`
 */
TritonApi.prototype.resizeInstance = function resizeInstance(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.package, 'opts.package');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline(
      {arg: {client: self, id: opts.id, package: opts.package}, funcs: [
        _stepInstId,

        _stepPkgId,

        function resizeMachine(arg, next) {
            self.cloudapi.resizeMachine({id: arg.instId, package: arg.pkgId},
                function (err, _res) {
                    res = _res;
                    next(err);
                });
        },

        function waitForSizeChanges(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self._waitForInstanceUpdate({
                id: arg.instId,
                timeout: opts.waitTimeout,
                isUpdated: function (machine) {
                    return arg.pkgName === machine.package;
                }
            }, next);
        }
    ]}, function (err) {
        cb(err, null, res);
    });
};

/**
 * rename a machine by id.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance name, short id, or id (a UUID).
 *      - {String} name: Required. The new instance name.
 *      - {Boolean} wait: Wait (via polling) until the rename is complete.
 *        Warning: A concurrent rename of the same instance can result in this
 *        polling being unable to notice the change. Use `waitTimeout` to
 *        put an upper bound.
 *      - {Number} waitTimeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting. Only relevant if
 *        `opts.wait === true`. Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} callback of the form `function (err, _, res)`
 */
TritonApi.prototype.renameInstance = function renameInstance(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function renameMachine(arg, next) {
            self.cloudapi.renameMachine({id: arg.instId, name: opts.name},
                function (err, _, _res) {
                    res = _res;
                    next(err);
            });
        },

        function waitForNameChanges(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self._waitForInstanceUpdate({
                id: arg.instId,
                timeout: opts.waitTimeout,
                isUpdated: function (machine) {
                    return opts.name === machine.name;
                }
            }, next);
        }
    ]}, function (err) {
        cb(err, null, res);
    });
};

/**
 * Shared implementation for any methods to change instance name.
 *
 * @param {Object} opts
 *      - {String} id: Required. The instance ID Required.
 *      - {Function} isUpdated: Required. A function which is passed the
 *        machine data, should check if the change has been applied and
 *        return a Boolean.
 *      - {Number} timeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting.
 *        Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err)`
 */
TritonApi.prototype._waitForInstanceUpdate =
function _waitForInstanceUpdate(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(opts.isUpdated, 'opts.isUpdated');
    assert.optionalNumber(opts.timeout, 'opts.timeout');
    var timeout = opts.hasOwnProperty('timeout') ? opts.timeout : Infinity;
    assert.ok(timeout > 0, 'opts.timeout must be greater than zero');
    assert.func(cb, 'cb');

    /*
     * Hardcoded 2s poll interval for now. Not yet configurable, being mindful
     * of avoiding lots of clients naively swamping a CloudAPI and hitting
     * throttling.
     */
    var POLL_INTERVAL = 2 * 1000;

    var startTime = Date.now();

    var poll = function () {
        self.cloudapi.getMachine({id: opts.id}, function (err, machine) {
            if (err) {
                cb(err);
                return;
            }
            if (opts.isUpdated(machine)) {
                cb();
                return;

            } else {
                var elapsedTime = Date.now() - startTime;
                if (elapsedTime > timeout) {
                    cb(new errors.TimeoutError(format('timeout waiting for '
                        + 'instance %s rename (elapsed %ds)',
                        opts.id, Math.round(elapsedTime / 1000))));
                } else {
                    setTimeout(poll, POLL_INTERVAL);
                }
            }
        });
    };

    setImmediate(poll);
};

/**
 * Creates a volume according to the parameters in "params" and calls the
 * function "cb" when done.
 *
 * @param {Object} params
 *      - {String} type: Required. The type of the volume to create. The only
 *        valid value for now is "tritonnfs".
 *      - {String} name: Optional. The name of the volume to create. If not
 *        provided, a name will be automatically generated.
 *      - {String} network: Optional. The network name, short id or id on which
 *        the newly created volume will be reachable.
 *      - {Number} size: Optional. The desired size of the volume in mebibytes.
 *        If no size if provided, the volume will be created with the smallest
 *        possible size as outputted by CloudAPI's ListVolumeSizes endpoint.
 *      - {Array of String} affinity: Optional affinity rules.
 *      - {Object} tags: Optional tag name/value pairs.
 * @param {Function} cb: `function (err, volume)`
 */
TritonApi.prototype.createVolume = function createVolume(params, cb) {
    assert.object(params, 'params');
    assert.string(params.type, 'params.type');
    assert.optionalString(params.name, 'params.name');
    assert.optionalString(params.network, 'params.network');
    assert.optionalNumber(params.size, 'params.size');
    assert.optionalArrayOfString(params.affinity, 'params.affinity');
    assert.optionalObject(params.tags, 'params.tags');
    assert.func(cb, 'cb');

    var self = this;
    var volumeCreated;

    vasync.pipeline({arg: {client: self}, funcs: [
        function doGetNetwork(arg, next) {
            if (params.network === undefined || params.network === null) {
                next();
                return;
            }

            arg.client.getNetwork(params.network,
                function onGetNetwork(getNetErr, net) {
                    if (getNetErr) {
                        next(getNetErr);
                    } else {
                        arg.networkId = net.id;
                        next();
                    }
                });
        },
        function doCreateVolume(arg, next) {
            var createVolParams = jsprim.deepCopy(params);
            if (arg.networkId) {
                createVolParams.networks = [arg.networkId];
            }

            arg.client.cloudapi.createVolume(createVolParams,
                function onVolumeCreated(volCreateErr, volume) {
                    volumeCreated = volume;
                    next(volCreateErr);
                });
        }
    ]}, function done(err) {
        cb(err, volumeCreated);
    });
};

/**
 * Get a volume by ID, exact name, or short ID, in that order.
 *
 * If there is more than one volume with that name, then this errors out.
 */
TritonApi.prototype.getVolume = function getVolume(id, cb) {
    assert.string(id, 'id');
    assert.func(cb, 'cb');

    var shortId;
    var self = this;
    var volume;

    vasync.pipeline({funcs: [
        function tryUuid(_, next) {
            var uuid;
            if (common.isUUID(id)) {
                uuid = id;
            } else {
                shortId = common.normShortId(id);
                if (shortId && common.isUUID(shortId)) {
                    // E.g. a >32-char docker volume ID normalized to a UUID.
                    uuid = shortId;
                } else {
                    next();
                    return;
                }
            }

            self.cloudapi.getVolume({id: uuid}, function (err, vol) {
                if (err) {
                    if (err.restCode === 'ResourceNotFound') {
                        err = new errors.ResourceNotFoundError(err,
                            format('volume with id %s was not found', uuid));
                    } else {
                        err = null;
                    }
                }
                volume = vol;
                next(err);
            });
        },

        function tryName(_, next) {
            if (volume !== undefined) {
                next();
                return;
            }

            self.cloudapi.listVolumes({
                predicate: JSON.stringify({
                    and: [
                        { ne: ['state', 'failed'] },
                        { eq: ['name', id] }
                    ]
                })
            }, function (listVolumesErr, volumes) {
                var err;

                if (listVolumesErr) {
                    next(listVolumesErr);
                    return;
                }

                assert.arrayOfObject(volumes, 'volumes');

                if (volumes.length === 1) {
                    volume = volumes[0];
                } else if (volumes.length > 1) {
                    err = new errors.TritonError(format(
                        'volume name "%s" is ambiguous: matches %d volumes',
                        id, volumes.length));
                }

                next(err);
            });
        },

        function tryShortId(_, next) {
            if (volume !== undefined || !shortId) {
                next();
                return;
            }

            self.cloudapi.listVolumes({
                predicate: JSON.stringify({
                    ne: ['state', 'failed']
                })
            }, function (listVolumesErr, volumes) {
                var candidate;
                var candidateIdx = 0;
                var err;
                var match;

                if (!listVolumesErr) {
                    for (candidateIdx in volumes) {
                        candidate = volumes[candidateIdx];
                        if (candidate.id.slice(0, shortId.length) === shortId) {
                            if (match) {
                                err = (new errors.TritonError(
                                    'instance short id "%s" is ambiguous',
                                    shortId));
                                break;
                            } else {
                                match = candidate;
                            }
                        }
                    }
                }

                volume = match;
                next(err);
            });
        }
    ]}, function getVolDone(err) {
        if (err || volume) {
            cb(err, volume);
        } else {
            cb(new errors.ResourceNotFoundError(format(
                'no volume with id, name or short id "%s" was found', id)));
        }
    });
};

/**
 * Deletes a volume by ID, exact name, or short ID, in that order.
 *
 *  If there is more than one volume with that name, then this errors out.
 *
 * @param {Object} opts
 *      - {String} id: Required. The volume to delete's id, name or short ID.
 *      - {Boolean} wait: Optional. true if "cb" must be called once the volume
 *        is actually deleted, or deletion failed. If "false", "cb" will be
 *        called as soon as the deletion process is scheduled.
 *      - {Number} waitTimeout: Optional. if "wait" is true, represents the
 *        number of milliseconds after which to timeout (call `cb` with a
 *        timeout error) waiting.
 * @param {Function} cb: `function (err)`
 */
TritonApi.prototype.deleteVolume = function deleteVolume(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepVolId,

        function doDelete(arg, next) {
            self.cloudapi.deleteVolume(arg.volId,
                function onVolDeleted(volDelErr, _, _res) {
                    res = _res;
                    next(volDelErr);
            });
        },

        function waitForVolumeDeleted(arg, next) {
            if (!opts.wait) {
                next();
                return;
            }
            self.cloudapi.waitForVolumeStates({
                id: arg.volId,
                states: ['failed'],
                timeout: opts.waitTimeout
            }, function onVolumeStateReached(err) {
                if (VError.hasCauseWithName(err, 'VolumeNotFoundError')) {
                    // volume is gone, that's not an error
                    next();
                    return;
                }
                next(err);
            });
        }
    ]}, function onDeletionComplete(err) {
        cb(err, null, res);
    });
};

// ---- Disks

/**
 * List an instance's disks.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 * @param {Function} callback `function (err, disks, res)`
 */
TritonApi.prototype.listInstanceDisks =
function listInstanceDisks(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var self = this;
    var res;
    var disks;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function listDisks(arg, next) {
            self.cloudapi.listMachineDisks({
                id: arg.instId
            }, function (err, listedDisks, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                disks = listedDisks;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, disks, res);
    });
};

/**
 * Get an instance's disk.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} diskId: The ID or short ID of the disk. Required.
 * @param {Function} callback `function (err, disk)`
 */
TritonApi.prototype.getInstanceDisk =
function getInstanceDisk(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.diskId, 'opts.diskId');
    assert.func(cb, 'cb');

    var self = this;
    var diskId = opts.diskId;
    var disks;
    var disk;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function listDisks(arg, next) {
            self.cloudapi.listMachineDisks({
                id: arg.instId
            }, function (err, listedDisks, _res) {
                disks = listedDisks;
                next(err);
            });
        },

        function filterDisk(_arg, next) {
            var matchingDisks = disks.filter(function getDisk(d) {
                return d.id === diskId || d.id.slice(0, 8) === diskId;
            });

            if (matchingDisks.length === 1) {
                disk = matchingDisks[0];
                next();
                return;
            }

            if (matchingDisks.length === 0) {
                next(new errors.ResourceNotFoundError(format(
                    'no disk with id "%s" was found', diskId)));
                return;
            }

            next(new errors.ResourceNotFoundError(
                format('Multiple disks with shortId "%s" were found '
                + 'and "%s" is an ambiguous short id', diskId)));
        }
    ]}, function (err) {
        cb(err, disk);
    });
};

/**
 * Add a disk to an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {Number} size: The size of the disk in mebibytes. Required.
 *        Optionally, the string "remaining" is also allowed.
 * @param {Function} callback `function (err, res)`
 */
TritonApi.prototype.addInstanceDisk =
function addInstanceDisk(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.ok(opts.size, 'opts.size');
    if (opts.size !== 'remaining') {
        assert.number(opts.size, 'opts.size');
        assert.ok(opts.size > 0, 'opts.size > 0');
    }
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');


    var self = this;
    var res;
    var body;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,

        function addDisk(arg, next) {
            self.cloudapi.createMachineDisk({
                id: arg.instId,
                size: opts.size
            }, function (err, _body, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                body = _body;
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, body, res);
    });
};

/**
 * Delete a disk to an instance.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} diskId: The disk ID or short ID. Required.
 * @param {Function} callback `function (err, res)`
 */
TritonApi.prototype.deleteInstanceDisk =
function deleteInstanceDisk(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.diskId, 'opts.diskId');
    assert.func(cb, 'cb');


    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,
        function getDisk(arg, next) {
            self.getInstanceDisk({
                id: arg.instId,
                diskId: opts.diskId
            }, function onDisk(err, disk) {
                if (err) {
                    next(err);
                    return;
                }

                arg.diskId = disk.id;
                next();
            });
        },
        function deleteDisk(arg, next) {
            self.cloudapi.deleteMachineDisk({
                id: arg.instId,
                diskId: arg.diskId
            }, function (err, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                res.diskId = arg.diskId; // same hack
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, res);
    });
};

/**
 * Resize an instance disk.
 *
 * @param {Object} opts
 *      - {String} id: The instance ID, name, or short ID. Required.
 *      - {String} diskId: The disk ID or short ID. Required.
 *      - {Number} size: The size of the disk in mebibytes. Required.
 *      - {Boolean} dangerousAllowShrink: Whether a disk can be shrunk.
 *        Optional.
 * @param {Function} callback `function (err, null, res)`
 */
TritonApi.prototype.resizeInstanceDisk =
function resizeInstanceDisk(opts, cb) {
    assert.string(opts.id, 'opts.id');
    assert.string(opts.diskId, 'opts.diskId');
    assert.number(opts.size, 'opts.size');
    assert.ok(opts.size > 0, 'opts.size > 0');
    assert.optionalBool(opts.dangerousAllowShrink, 'opts.dangerousAllowShrink');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var self = this;
    var res;

    vasync.pipeline({arg: {client: self, id: opts.id}, funcs: [
        _stepInstId,
        function getDisk(arg, next) {
            self.getInstanceDisk({
                id: arg.instId,
                diskId: opts.diskId
            }, function onDisk(err, disk) {
                if (err) {
                    next(err);
                    return;
                }

                arg.diskId = disk.id;
                next();
            });
        },
        function resizeDisk(arg, next) {
            self.cloudapi.resizeMachineDisk({
                id: arg.instId,
                diskId: arg.diskId,
                size: opts.size,
                dangerousAllowShrink: opts.dangerousAllowShrink
            }, function (err, _, _res) {
                res = _res;
                res.instId = arg.instId; // gross hack, in case caller needs it
                next(err);
            });
        }
    ]}, function (err) {
        cb(err, null, res);
    });
};

// ---- exports

module.exports = {
    CLOUDAPI_ACCEPT_VERSION: CLOUDAPI_ACCEPT_VERSION,
    createClient: function createClient(opts) {
        return new TritonApi(opts);
    }
};
