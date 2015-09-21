/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * Core TritonApi client driver class.
 */

var p = console.log;
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

var cloudapi = require('./cloudapi2');
var common = require('./common');
var errors = require('./errors');
var loadConfigSync = require('./config').loadConfigSync;



//---- TritonApi class

/**
 * Create a TritonApi client.
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

    if (this.config.cacheDir) {
        this.cacheDir = path.resolve(this.config._configDir,
            this.config.cacheDir,
            common.slug(this.profile));
        this.log.trace({cacheDir: this.cacheDir}, 'cache dir');
        // TODO perhaps move this to an async .init()
        if (!fs.existsSync(this.cacheDir)) {
            try {
                mkdirp.sync(this.cacheDir);
            } catch (e) {
                throw e;
            }
        }
    }

    this.cloudapi = this._cloudapiFromProfile(this.profile);
}



TritonApi.prototype._cloudapiFromProfile =
    function _cloudapiFromProfile(profile)
{
    assert.object(profile, 'profile');
    assert.string(profile.account, 'profile.account');
    assert.string(profile.keyId, 'profile.keyId');
    assert.string(profile.url, 'profile.url');
    assert.optionalString(profile.privKey, 'profile.privKey');
    assert.optionalBool(profile.insecure, 'profile.insecure');
    var rejectUnauthorized = (profile.insecure === undefined
        ? true : !profile.insecure);

    var sign;
    if (profile.privKey) {
        sign = auth.privateKeySigner({
            user: profile.account,
            keyId: profile.keyId,
            key: profile.privKey
        });
    } else {
        sign = auth.cliSigner({
            keyId: profile.keyId,
            user: profile.account
        });
    }
    var client = cloudapi.createClient({
        url: profile.url,
        user: profile.account,
        version: '*',
        rejectUnauthorized: rejectUnauthorized,
        sign: sign,
        log: this.log
    });
    return client;
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

TritonApi.prototype._cacheGetJson = function _cacheGetJson(key, cb) {
    var self = this;
    assert.string(this.cacheDir, 'this.cacheDir');
    assert.string(key, 'key');
    assert.func(cb, 'cb');

    var keyPath = path.resolve(this.cacheDir, key);
    fs.exists(keyPath, function (exists) {
        if (!exists) {
            self.log.trace({keyPath: keyPath}, 'cache file does not exist');
            return cb();
        }
        fs.readFile(keyPath, 'utf8', function (err, data) {
            if (err) {
                self.log.warn({err: err, keyPath: keyPath},
                    'error reading cache file');
                return cb();
            }
            var obj;
            try {
                obj = JSON.parse(data);
            } catch (dataErr) {
                self.log.warn({err: dataErr, keyPath: keyPath},
                    'error parsing JSON cache file');
                return cb();
            }
            cb(null, obj);
        });
    });
};


/**
 * CloudAPI listImages wrapper with optional caching.
 *
 * @param opts {Object} Optional.
 *      - useCase {Boolean} Whether to use Triton's local cache.
 *      - ... all other cloudapi ListImages options
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

    var cacheKey = 'images.json';
    var cached;
    var fetched;
    var res;

    vasync.pipeline({funcs: [
        function tryCache(_, next) {
            if (!opts.useCache) {
                return next();
            }
            self._cacheGetJson(cacheKey, function (err, cached_) {
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
            if (!fetched) {
                return next();
            }
            self._cachePutJson(cacheKey, fetched, next);
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
TritonApi.prototype.getImage = function getImage(name, cb) {
    assert.string(name, 'name');
    assert.func(cb, 'cb');

    if (common.UUID_RE.test(name)) {
        this.cloudapi.getImage({id: name}, function (err, img) {
            if (err) {
                cb(err);
            } else if (img.state !== 'active') {
                cb(new Error(format('image %s is not active', name)));
            } else {
                cb(null, img);
            }
        });
    } else {
        this.cloudapi.listImages(function (err, imgs) {
            if (err) {
                return cb(err);
            }

            var nameMatches = [];
            var shortIdMatches = [];
            for (var i = 0; i < imgs.length; i++) {
                var img = imgs[i];
                if (img.name === name) {
                    nameMatches.push(img);
                }
                if (img.id.slice(0, 8) === name) {
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
                cb(new Error(format(
                    'no image with name or short id "%s" was found', name)));
            } else {
                cb(new Error(format('no image with name "%s" was found '
                    + 'and "%s" is an ambiguous short id', name)));
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

    if (common.UUID_RE.test(name)) {
        this.cloudapi.getPackage({id: name}, function (err, pkg) {
            if (err) {
                cb(err);
            } else if (!pkg.active) {
                cb(new Error(format('package %s is not active', name)));
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
                cb(new Error(format(
                    'package name "%s" is ambiguous: matches %d packages',
                    name, nameMatches.length)));
            } else if (shortIdMatches.length === 1) {
                cb(null, shortIdMatches[0]);
            } else if (shortIdMatches.length === 0) {
                cb(new Error(format(
                    'no package with name or short id "%s" was found', name)));
            } else {
                cb(new Error(format('no package with name "%s" was found '
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
                cb(new Error(format(
                    'network name "%s" is ambiguous: matches %d networks',
                    name, nameMatches.length)));
            } else if (shortIdMatches.length === 1) {
                cb(null, shortIdMatches[0]);
            } else if (shortIdMatches.length === 0) {
                cb(new Error(format(
                    'no network with name or short id "%s" was found', name)));
            } else {
                cb(new Error(format('no network with name "%s" was found '
                    + 'and "%s" is an ambiguous short id', name)));
            }
        });
    }
};


/**
 * Get an instance by ID, exact name, or short ID, in that order.
 *
 * @param {String} name
 * @param {Function} callback `function (err, inst)`
 */
TritonApi.prototype.getInstance = function getInstance(name, cb) {
    var self = this;
    assert.string(name, 'name');
    assert.func(cb, 'cb');

    var shortId;
    var inst;

    vasync.pipeline({funcs: [
        function tryUuid(_, next) {
            var uuid;
            if (common.isUUID(name)) {
                uuid = name;
            } else {
                shortId = common.normShortId(name);
                if (shortId && common.isUUID(shortId)) {
                    // E.g. a >32-char docker container ID normalized to a UUID.
                    uuid = shortId;
                } else {
                    return next();
                }
            }
            self.cloudapi.getMachine(uuid, function (err, inst_) {
                inst = inst_;
                next(err);
            });
        },

        function tryName(_, next) {
            if (inst) {
                return next();
            }

            self.cloudapi.listMachines({name: name}, function (err, insts) {
                if (err) {
                    return next(err);
                }
                for (var i = 0; i < insts.length; i++) {
                    if (insts[i].name === name) {
                        inst = insts[i];
                        // Relying on rule that instance name is unique
                        // for a user and DC.
                        return next();
                    }
                }
                next();
            });
        },

        function tryShortId(_, next) {
            if (inst || !shortId) {
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
                            return nextOnce(new Error(
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
                    inst = match;
                }
                nextOnce();
            });
        }
    ]}, function (err) {
        if (err) {
            cb(err);
        } else if (inst) {
            cb(null, inst);
        } else {
            cb(new Error(format(
                'no instance with name or short id "%s" was found', name)));
        }
    });
};


//---- exports

module.exports = TritonApi;
