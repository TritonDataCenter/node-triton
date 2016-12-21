/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

/* BEGIN JSSTYLED */
/*
 * Core `TritonApi` client class. A TritonApi client object is a wrapper around
 * a lower-level `CloudApi` client that makes raw calls to
 * [Cloud API](https://apidocs.joyent.com/cloudapi/). The wrapper provides
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
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var format = require('util').format;
var mkdirp = require('mkdirp');
var once = require('once');
var path = require('path');
var restifyClients = require('restify-clients');
// We are cheating here. restify-clients should export its 'bunyan'.
var restifyBunyanSerializers =
    require('restify-clients/lib/helpers/bunyan').serializers;
var tabula = require('tabula');
var vasync = require('vasync');
var sshpk = require('sshpk');

var cloudapi = require('./cloudapi2');
var common = require('./common');
var errors = require('./errors');


// ---- globals

var CLOUDAPI_ACCEPT_VERSION = '~8||~7';



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

//---- TritonApi class

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

    var opts = {
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
            opts.principal.keyPair =
            auth.KeyPair.fromPrivateKey(key);
        this.cloudapi = cloudapi.createClient(opts);
        cb(null);
    } else {
        var kr = new auth.KeyRing();
        var fp = sshpk.parseFingerprint(profile.keyId);
        kr.findSigningKeyPair(fp, function (err, kp) {
            if (err) {
                cb(err);
                return;
            }
            self.keyPair = opts.principal.keyPair = kp;
            self.cloudapi = cloudapi.createClient(opts);
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
 *        <https://apidocs.joyent.com/cloudapi/#ListImages>
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
            self._cacheGetJson(cacheKey, 5*60, function (err, cached_) {
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
 */
TritonApi.prototype.getImage = function getImage(opts, cb) {
    var self = this;
    if (typeof (opts) === 'string')
        opts = {name: opts};
    assert.object(opts, 'opts');
    assert.string(opts.name, 'opts.name');
    assert.optionalBool(opts.useCache, 'opts.useCache');
    assert.func(cb, 'cb');

    var img;
    if (common.isUUID(opts.name)) {
        vasync.pipeline({funcs: [
            function tryCache(_, next) {
                if (!opts.useCache) {
                    next();
                    return;
                }
                var cacheKey = 'images.json';
                self._cacheGetJson(cacheKey, 60*60, function (err, images) {
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

        var listOpts = {
            // Explicitly include inactive images.
            state: 'all'
        };
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
        this.cloudapi.getNetwork(name, function (err, net) {
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
        this.cloudapi.listNetworks(function (err, nets) {
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
 * Get an instance.
 *
 * Alternative call signature: `getInstance(id, cb)`.
 *
 * @param {Object} opts
 *      - {UUID} id: The instance ID, name, or short ID. Required.
 *      - {Array} fields: Optional. An array of instance field names that are
 *        wanted by the caller. This *can* allow the implementation to avoid
 *        extra API calls. E.g. `['id', 'name']`.
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
            self.cloudapi.getMachine(uuid, function (err, inst_, res_) {
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
                    if (! instFromList.hasOwnProperty(opts.fields[i])) {
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
            self.cloudapi.getMachine(uuid, function (err, inst_, res_) {
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


// ---- instance tags

/**
 * List an instance's tags.
 * <http://apidocs.joyent.com/cloudapi/#ListMachineTags>
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
 * <http://apidocs.joyent.com/cloudapi/#GetMachineTag>
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
 * <http://apidocs.joyent.com/cloudapi/#AddMachineTags>
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
 * <http://apidocs.joyent.com/cloudapi/#ReplaceMachineTags>
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
 * <http://apidocs.joyent.com/cloudapi/#DeleteMachineTag>
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
 * <http://apidocs.joyent.com/cloudapi/#DeleteMachineTags>
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
                return cb(err);
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
 *      - {String} description: Description of the rule. Optional.
 *      At least one of the fields must be provided.
 * @param {Function} callback `function (err, fwrule, res)`
 */
TritonApi.prototype.updateFirewallRule = function updateFirewallRule(opts, cb) {
    // TODO: strict opts field validation
    assert.string(opts.id, 'opts.id');
    assert.optionalString(opts.rule, 'opts.rule');
    assert.optionalBool(opts.enabled, 'opts.enabled');
    assert.optionalString(opts.description, 'opts.description');
    assert.ok(opts.rule !== undefined || opts.enabled !== undefined ||
        opts.description !== undefined, 'at least one of opts.rule, '
        + 'opts.enabled, or opts.description is required');
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
            self._waitForInstanceRename({
                id: arg.instId,
                timeout: opts.waitTimeout,
                name: opts.name
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
 *      - {String} id: The instance ID Required.
 *      - {String} name: Required change new name
 *      - {Number} timeout: The number of milliseconds after which to
 *        timeout (call `cb` with a timeout error) waiting.
 *        Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb: `function (err)`
 */

TritonApi.prototype._waitForInstanceRename =
function _waitForInstanceRename(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.optionalNumber(opts.timeout, 'opts.timeout');
    var timeout = opts.hasOwnProperty('timeout') ? opts.timeout : Infinity;
    assert.ok(timeout > 0, 'opts.timeout must be greater than zero');
    assert.string(opts.name, 'opts.name');
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
            if (opts.name === machine.name) {
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

//---- exports

module.exports = {
    CLOUDAPI_ACCEPT_VERSION: CLOUDAPI_ACCEPT_VERSION,
    createClient: function createClient(opts) {
        return new TritonApi(opts);
    }
};
