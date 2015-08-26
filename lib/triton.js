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
var once = require('once');
var path = require('path');
var restifyClients = require('restify-clients');
var sprintf = require('util').format;
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
    this.config = loadConfigSync();
    this.profiles = this.config.profiles;
    this.profile = this.getProfile(
        options.profile || this.config.defaultProfile);
    this.log.trace({profile: this.profile}, 'profile data');

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
 * Get an image by ID or name. If there is more than one image with that name,
 * then the latest (by published_at) is returned.
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
            for (var i = 0; i < imgs.length; i++) {
                if (imgs[i].name === name) {
                    nameMatches.push(imgs[i]);
                }
            }
            if (nameMatches.length === 0) {
                cb(new Error(format('no image with name=%s was found',
                    name)));
            } else if (nameMatches.length === 1) {
                cb(null, nameMatches[0]);
            } else {
                tabula.sortArrayOfObjects(nameMatches, 'published_at');
                cb(null, nameMatches[nameMatches.length - 1]);
            }
        });
    }
};


/**
 * Get an active package by ID or name. If there is more than one package
 * with that name, then this errors out.
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
            for (var i = 0; i < pkgs.length; i++) {
                if (pkgs[i].name === name) {
                    nameMatches.push(pkgs[i]);
                }
            }
            if (nameMatches.length === 0) {
                cb(new Error(format('no package with name=%s was found',
                    name)));
            } else if (nameMatches.length === 1) {
                cb(null, nameMatches[0]);
            } else {
                cb(new Error(format(
                    'package name "%s" is ambiguous: matches %d packages',
                    name, nameMatches.length)));
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