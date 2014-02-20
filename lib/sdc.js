/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Core SDC driver class.
 */

var p = console.log;
var assert = require('assert-plus');
var async = require('async');
var auth = require('smartdc-auth');
var EventEmitter = require('events').EventEmitter;
var format = require('util').format;
var fs = require('fs');
var path = require('path');
var restify = require('restify');

var cloudapi = require('./cloudapi2');
var common = require('./common');
var loadConfigSync = require('./config').loadConfigSync;



//---- SDC class

/**
 * Create a SDC client.
 *
 * @param options {Object}
 *      - log {Bunyan Logger}
 *      - profile {String} Optional. Name of profile to use. Defaults to
 *        'defaultProfile' in the config.
 */
function SDC(options) {
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
            serializers: restify.bunyan.serializers
        });
    } else {
        this.log = options.log;
    }
    this.config = loadConfigSync();
    this.profiles = this.config.profiles;
    this.profile = this.getProfile(
        options.profile || this.config.defaultProfile);
    this.log.trace({profile: this.profile}, 'profile data');
}


SDC.prototype.setDefaultProfile =
function setDefaultProfile(name, callback) {
    if (!this.getProfile(name)) {
        return callback(new Error('no such profile: ' + name));
    }
    this.defaultProfileName = this.config.defaultProfile = name;
    common.saveConfigSync(this.config);
    callback();
};

SDC.prototype.getProfile = function getProfile(name) {
    for (var i = 0; i < this.profiles.length; i++) {
        if (this.profiles[i].name === name) {
            return this.profiles[i];
        }
    }
};

/**
 * Create or update a profile.
 *
 * @param profile {Object}
 * @param options {Object}
 *      - setDefault {Boolean}
 * @param callback {Function} `function (err)`
 */
SDC.prototype.createOrUpdateProfile = function createOrUpdateProfile(
        profile, options, callback) {
    assert.object(profile, 'profile');
    if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.optionalBool(options.setDefault, 'options.setDefault');
    assert.func(callback, 'callback');

    var found = false;
    for (var i = 0; i < this.profiles.length; i++) {
        if (this.profiles[i].name === profile.name) {
            this.profiles[i] = profile;
            found = true;
        }
    }
    if (!found) {
        this.profiles.push(profile);
    }
    if (options.setDefault) {
        this.defaultProfileName = this.config.defaultProfile = profile.name;
    }
    common.saveConfigSync(this.config);
    callback();
};

SDC.prototype.deleteProfile = function deleteProfile(name, callback) {
    var found = false;
    for (var i = 0; i < this.profiles.length; i++) {
        if (this.profiles[i].name === name) {
            found = true;
            this.profiles.splice(i, 1);
        }
    }
    if (!found) {
        return callback(new Error('no such profile: ' + name));
    }
    if (this.defaultProfileName === name) {
        this.defaultProfileName = this.config.defaultProfile = null;
    }
    common.saveConfigSync(this.config);
    callback();
};


SDC.prototype._clientFromDc = function _clientFromDc(dc) {
    assert.string(dc, 'dc');

    if (!this._clientFromDcCache) {
        this._clientFromDcCache = {};
    }
    if (!this._clientFromDcCache[dc]) {
        var prof = this.profile;
        var sign;
        if (prof.privKey) {
            sign = auth.privateKeySigner({
                user: prof.user,
                keyId: prof.keyId,
                key: prof.privKey
            });
        } else {
            sign = auth.cliSigner({
                keyId: prof.keyId,
                user: prof.user
            });
        }
        var client = cloudapi.createClient({
            url: this.config.dcs[dc],
            user: prof.user,
            version: '*',
            rejectUnauthorized: Boolean(prof.rejectUnauthorized),
            sign: sign,
            log: this.log
        });
        this._clientFromDcCache[dc] = client;
    }
    return this._clientFromDcCache[dc];
};



/**
 * List machines for the current profile.
 *
 *      var res = this.jc.listMachines();
 *      res.on('data', function (dc, dcMachines) {
 *          //...
 *      });
 *      res.on('dcError', function (dc, dcErr) {
 *          //...
 *      });
 *      res.on('end', function () {
 *          //...
 *      });
 *
 * @param {Object} options  Optional
 */
SDC.prototype.listMachines = function listMachines(options) {
    var self = this;
    if (options === undefined) {
        options = {};
    }
    assert.object(options, 'options');

    var emitter = new EventEmitter();

    async.each(
        self.profile.dcs || Object.keys(self.config.dcs),
        function oneDc(dc, next) {
            var client = self._clientFromDc(dc);
            client.listMachines(function (err, machines) {
                if (err) {
                    emitter.emit('dcError', dc, err);
                } else {
                    emitter.emit('data', dc, machines);
                }
                next();
            });
        },
        function done(err) {
            emitter.emit('end');
        }
    );
    return emitter;
};



//---- exports

module.exports = SDC;
