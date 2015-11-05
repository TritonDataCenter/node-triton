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
    assert.optionalString(profile.user, 'profile.user');
    assert.optionalString(profile.privKey, 'profile.privKey');
    assert.optionalBool(profile.insecure, 'profile.insecure');
    var rejectUnauthorized = (profile.insecure === undefined
        ? true : !profile.insecure);

    var sign;
    if (profile.privKey) {
        sign = auth.privateKeySigner({
            user: profile.account,
            subuser: profile.user,
            keyId: profile.keyId,
            key: profile.privKey
        });
    } else {
        sign = auth.cliSigner({
            keyId: profile.keyId,
            user: profile.account,
            subuser: profile.user
        });
    }
    var client = cloudapi.createClient({
        url: profile.url,
        account: profile.account,
        user: profile.user,
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
    fs.readFile(keyPath, 'utf8', function (err, data) {
        if (err && err.code === 'ENOENT') {
            self.log.trace({keyPath: keyPath},
                'cache file does not exist');
            return cb();
        } else if (err) {
            self.log.warn({err: err, keyPath: keyPath},
                'error reading cache file');
            return cb();
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
                cb(err2);
            });
            return;
        }
        cb(null, obj);
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
                self._cacheGetJson('images.json', function (err, images) {
                    if (err) {
                        next(err);
                        return;
                    }
                    for (var i = 0; i < images.length; i++) {
                        if (images[i].id === opts.name) {
                            img = images[i];
                            break;
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
            } else if (img.state !== 'active') {
                cb(new errors.TritonError(
                    format('image %s is not active', opts.name)));
            } else {
                cb(null, img);
            }
        });
    } else {
        var s = opts.name.split('@');
        var name = s[0];
        var version = s[1];

        var listOpts = {};
        if (version) {
            listOpts.name = name;
            listOpts.version = version;
            listOpts.useCache = opts.useCache;
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
                    'no image with name or short id "%s" was found', name)));
            } else {
                cb(new errors.ResourceNotFoundError(
                    format('no image with name "%s" was found '
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

    if (common.isUUID(name)) {
        this.cloudapi.getPackage({id: name}, function (err, pkg) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    err = new errors.ResourceNotFoundError(err,
                        format('package with id %s was not found', name));
                }
                cb(err);
            } else if (!pkg.active) {
                cb(new errors.TritonError(
                    format('package %s is not active', name)));
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
                if (err && err.restCode === 'ResourceNotFound') {
                    // The CloudApi 404 error message sucks: "VM not found".
                    err = new errors.ResourceNotFoundError(err,
                        format('instance with id %s was not found', name));
                }
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
            cb(new errors.ResourceNotFoundError(format(
                'no instance with name or short id "%s" was found', name)));
        }
    });
};



/**
 * Get an RBAC user by ID, login, or short ID, in that order.
 *
 * @param {Object} opts
 *      - id {UUID|String} The user ID (a UUID), login or short id.
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

    /*
     * CloudAPI GetUser supports a UUID or login, so we try that first.
     * If that is a 404 and `opts.id` a valid shortid, then try to lookup
     * via `listUsers`.
     */
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
                        ctx.notFoundErr = err;
                        next();
                    } else {
                        next(err);
                    }
                } else {
                    ctx.user = user;
                    next();
                }
            });
        },

        function tryShortId(ctx, next) {
            if (ctx.user) {
                next();
                return;
            }
            var shortId = common.normShortId(opts.id);
            if (!shortId) {
                next();
                return;
            }

            self.cloudapi.listUsers(function (err, users) {
                if (err) {
                    next(err);
                    return;
                }

                var shortIdMatches = [];
                for (var i = 0; i < users.length; i++) {
                    var user = users[i];
                    // TODO: use this test in other shortId matching
                    if (user.id.slice(0, shortId.length) === shortId) {
                        shortIdMatches.push(user);
                    }
                }

                if (shortIdMatches.length === 1) {
                    ctx.user = shortIdMatches[0];
                    next();
                } else if (shortIdMatches.length === 0) {
                    next(new errors.ResourceNotFoundError(format(
                        'user with login or id matching "%s" was not found',
                        opts.id)));
                } else {
                    next(new errors.ResourceNotFoundError(
                        format('user with login "%s" was not found '
                        + 'and "%s" is an ambiguous short id', opts.id)));
                }
            });
        },

        /*
         * If we found the user via `listUsers` and `opts.roles` was requested
         * then we need to re-getUser.
         */
        function reGetUserIfNecessary(ctx, next) {
            if (!ctx.user) {
                // We must have gotten the `notFoundErr` above.
                next(new errors.ResourceNotFoundError(ctx.notFoundErr, format(
                    'user with login or id "%s" was not found', opts.id)));
                return;
            } else if (!opts.roles || ctx.user.roles) {
                next();
                return;
            }

            var getOpts = {
                id: ctx.user.id,
                membership: opts.roles
            };
            self.cloudapi.getUser(getOpts, function (err, user) {
                if (err) {
                    if (err.restCode === 'ResourceNotFound') {
                        next(new errors.ResourceNotFoundError(err, format(
                            'user with id "%s" was not found', opts.id)));
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
            self.cloudapi.listUserKeys({id: ctx.user.id}, function (err, keys) {
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
 * Get an RBAC role by ID, name, or short ID, in that order.
 *
 * @param {Object} opts
 *      - id {UUID|String} The RBAC role id (a UUID), name or short id.
 * @param {Function} callback of the form `function (err, role)`
 */
TritonApi.prototype.getRole = function getRole(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    /*
     * CloudAPI GetRole supports a UUID or name, so we try that first.
     * If that is a 404 and `opts.id` a valid shortid, then try to lookup
     * via `listRoles`.
     */
    var context = {};
    vasync.pipeline({arg: context, funcs: [
        function tryGetRole(ctx, next) {
            self.cloudapi.getRole({id: opts.id}, function (err, role) {
                if (err) {
                    if (err.restCode === 'ResourceNotFound') {
                        ctx.notFoundErr = err;
                        next();
                    } else {
                        next(err);
                    }
                } else {
                    ctx.role = role;
                    next();
                }
            });
        },

        function tryShortId(ctx, next) {
            if (ctx.role) {
                next();
                return;
            }
            var shortId = common.normShortId(opts.id);
            if (!shortId) {
                next();
                return;
            }

            self.cloudapi.listRoles(function (err, roles) {
                if (err) {
                    next(err);
                    return;
                }

                var shortIdMatches = [];
                for (var i = 0; i < roles.length; i++) {
                    var role = roles[i];
                    if (role.id.slice(0, shortId.length) === shortId) {
                        shortIdMatches.push(role);
                    }
                }

                if (shortIdMatches.length === 1) {
                    ctx.role = shortIdMatches[0];
                    next();
                } else if (shortIdMatches.length === 0) {
                    next(new errors.ResourceNotFoundError(format(
                        'role with id or name matching "%s" was not found',
                        opts.id)));
                } else {
                    next(new errors.ResourceNotFoundError(
                        format('role with name "%s" was not found '
                        + 'and "%s" is an ambiguous short id', opts.id)));
                }
            });
        },

        function raiseEarlierNotFoundErrIfNotFound(ctx, next) {
            if (!ctx.role) {
                // We must have gotten the `notFoundErr` above.
                next(new errors.ResourceNotFoundError(ctx.notFoundErr, format(
                    'role with name or id "%s" was not found', opts.id)));
            } else {
                next();
            }
        }
    ]}, function (err) {
        cb(err, context.role);
    });
};



/**
 * Delete an RBAC role by ID, name, or short ID, in that order.
 *
 * @param {Object} opts
 *      - id {UUID|String} The role id (a UUID), name or short id.
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

            self.getRole({id: opts.id}, function (err, role) {
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
 * Get an RBAC policy by ID, name, or short ID, in that order.
 *
 * @param {Object} opts
 *      - id {UUID|String} The RBAC policy id (a UUID), name or short id.
 * @param {Function} callback of the form `function (err, policy)`
 */
TritonApi.prototype.getPolicy = function getPolicy(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    /*
     * CloudAPI GetPolicy supports a UUID or name, so we try that first.
     * If that is a 404 and `opts.id` a valid shortid, then try to lookup
     * via `listPolicies`.
     */
    var context = {};
    vasync.pipeline({arg: context, funcs: [
        function tryGetIt(ctx, next) {
            self.cloudapi.getPolicy({id: opts.id}, function (err, policy) {
                if (err) {
                    if (err.restCode === 'ResourceNotFound') {
                        ctx.notFoundErr = err;
                        next();
                    } else {
                        next(err);
                    }
                } else {
                    ctx.policy = policy;
                    next();
                }
            });
        },

        function tryShortId(ctx, next) {
            if (ctx.policy) {
                next();
                return;
            }
            var shortId = common.normShortId(opts.id);
            if (!shortId) {
                next();
                return;
            }

            self.cloudapi.listRoles(function (err, policies) {
                if (err) {
                    next(err);
                    return;
                }

                var shortIdMatches = [];
                for (var i = 0; i < policies.length; i++) {
                    var policy = policies[i];
                    if (policy.id.slice(0, shortId.length) === shortId) {
                        shortIdMatches.push(policy);
                    }
                }

                if (shortIdMatches.length === 1) {
                    ctx.policy = shortIdMatches[0];
                    next();
                } else if (shortIdMatches.length === 0) {
                    next(new errors.ResourceNotFoundError(format(
                        'policy with id or name matching "%s" was not found',
                        opts.id)));
                } else {
                    next(new errors.ResourceNotFoundError(
                        format('policy with name "%s" was not found '
                        + 'and "%s" is an ambiguous short id', opts.id)));
                }
            });
        },

        function raiseEarlierNotFoundErrIfNotFound(ctx, next) {
            if (!ctx.policy) {
                // We must have gotten the `notFoundErr` above.
                next(new errors.ResourceNotFoundError(ctx.notFoundErr, format(
                    'policy with name or id "%s" was not found', opts.id)));
            } else {
                next();
            }
        }
    ]}, function (err) {
        cb(err, context.policy);
    });
};



/**
 * Delete an RBAC policy by ID, name, or short ID, in that order.
 *
 * @param {Object} opts
 *      - id {UUID|String} The policy id (a UUID), name or short id.
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

            self.getPolicy({id: opts.id}, function (err, policy) {
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


//---- exports

module.exports.createClient = function (options) {
    return new TritonApi(options);
};
