/*
 * Copyright (c) 2015, Joyent, Inc. All rights reserved.
 *
 * Core Triton client driver class.
 */

var p = console.log;
var assert = require('assert-plus');
var auth = require('smartdc-auth');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var format = require('util').format;
var once = require('once');
var path = require('path');
var restifyClients = require('restify-clients');
var tabula = require('tabula');

var cloudapi = require('./cloudapi2');
var common = require('./common');
var errors = require('./errors');
var loadConfigSync = require('./config').loadConfigSync;



//---- Triton class

/**
 * Create a Triton client.
 *
 * @param options {Object}
 *      - log {Bunyan Logger}
 *      - profile {String} Optional. Name of profile to use. Defaults to
 *        'defaultProfile' in the config.
 */
function Triton(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.optionalString(options.profile, 'options.profile');
    assert.optionalString(options.config, 'options.config');
    assert.optionalString(options.cachedir, 'options.cachedir');

    // Make sure a given bunyan logger has reasonable client_re[qs] serializers.
    // Note: This was fixed in restify, then broken again in
    // https://github.com/mcavage/node-restify/pull/501
    if (options.log.serializers &&
        (!options.log.serializers.client_req ||
        !options.log.serializers.client_req)) {
        this.log = options.log.child({
            // XXX cheating. restify-clients should export its 'bunyan'.
            serializers: require('restify-clients/lib/helpers/bunyan').serializers
        });
    } else {
        this.log = options.log;
    }
    this.config = loadConfigSync(options.config);
    this.profiles = this.config.profiles;
    this.profile = this.getProfile(
        options.profile || this.config.defaultProfile);
    this.log.trace({profile: this.profile}, 'profile data');
    this.cachedir = options.cachedir;

    this.cloudapi = this._cloudapiFromProfile(this.profile);
}



Triton.prototype.getProfile = function getProfile(name) {
    for (var i = 0; i < this.profiles.length; i++) {
        if (this.profiles[i].name === name) {
            return this.profiles[i];
        }
    }
};


Triton.prototype._cloudapiFromProfile = function _cloudapiFromProfile(profile) {
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

/**
 * cloudapi listImages wrapper with optional caching
 */
Triton.prototype.listImages = function listImages(opts, cb) {
    var self = this;
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var cachefile;
    if (self.cachedir)
        cachefile = path.join(self.cachedir, 'images.json');

    if (opts.usecache && !cachefile) {
        cb(new Error('opts.usecache set but no cachedir found'));
        return;
    }

    // try to read the cache if the user wants it
    // if this fails for any reason we fallback to hitting the cloudapi
    if (opts.usecache) {
        fs.readFile(cachefile, 'utf8', function (err, out) {
            if (err) {
                self.log.info({err: err}, 'failed to read cache file %s', cachefile);
                fetch();
                return;
            }
            var data;
            try {
                data = JSON.parse(out);
            } catch (e) {
                self.log.info({err: e}, 'failed to parse cache file %s', cachefile);
                fetch();
                return;
            }

            cb(null, data, {});
        });
        return;
    }

    fetch();
    function fetch() {
        self.cloudapi.listImages(function (err, imgs, res) {
            if (!err && self.cachedir) {
                // cache the results
                var data = JSON.stringify(imgs);
                fs.writeFile(cachefile, data, {encoding: 'utf8'}, function (err) {
                    if (err)
                        self.log.info({err: err}, 'error caching images results');
                    done();
                });
            } else {
                done();
            }


            function done() {
                cb(err, imgs, res);
            }
        });
    }
};

/**
 * Get an image by ID, exact name, or short ID, in that order.
 *
 * If there is more than one image with that name, then the latest
 * (by published_at) is returned.
 */
Triton.prototype.getImage = function getImage(name, cb) {
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
                    'no image with name or shortId "%s" was found', name)));
            } else {
                cb(new Error(format('no image with name "%s" was found '
                    + 'and "%s" is an ambiguous shortId', name)));
            }
        });
    }
};


/**
 * Get an active package by ID, exact name, or short ID, in that order.
 *
 * If there is more than one package with that name, then this errors out.
 */
Triton.prototype.getPackage = function getPackage(name, cb) {
    assert.string(name, 'name');
    assert.func(cb, 'cb');

    if (common.UUID_RE.test(name)) {
        this.cloudapi.getPackage({id: name}, function (err, pkg) {
            if (err) {
                cb(err);
            } else if (!pkg.active) {
                cb(new Error(format('image %s is not active', name)));
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
                    'no package with name or shortId "%s" was found', name)));
            } else {
                cb(new Error(format('no package with name "%s" was found '
                    + 'and "%s" is an ambiguous shortId', name)));
            }
        });
    }
};


/**
 * getMachine for an alias
 *
 * @param {String} alias - the machine alias
 * @param {Function} callback `function (err, machine)`
 */
Triton.prototype.getMachineByAlias = function getMachineByAlias(alias, callback) {
    this.cloudapi.listMachines({name: alias}, function (err, machines) {
        if (err) {
            callback(err);
            return;
        }
        var found = false;
        machines.forEach(function (machine) {
            if (!found && machine.name === alias) {
                callback(null, machine);
                found = true;
            }
        });
        if (!found) {
            callback(new Error('machine ' + alias + ' not found'));
            return;
        }
    });
};


//---- exports

module.exports = Triton;
