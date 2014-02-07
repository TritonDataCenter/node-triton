/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Core Joyent driver class.
 */

var p = console.log;
var assert = require('assert-plus');
var async = require('async');
var format = require('util').format;
var fs = require('fs');
var path = require('path');
var smartdc = require('smartdc');

var common = require('./common');
var loadConfigSync = require('./config').loadConfigSync;



//---- Joyent class

/**
 * Create a Joyent.
 *
 * @param options {Object}
 *      - log {Bunyan Logger}
 *      - profile {String} Optional. Name of profile to use. Defaults to
 *        'defaultProfile' in the config.
 */
function Joyent(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.optionalString(options.profile, 'options.profile');
    var self = this;

    this.config = loadConfigSync();
    this.profiles = this.config.profiles;
    this.profile = this.getProfile(
        options.profile || this.config.defaultProfile);

    this.log = options.log;
    this.log.trace({profile: this.profile}, 'profile data');
}


Joyent.prototype.setDefaultProfile = function setDefaultProfile(name, callback) {
    if (!this.getProfile(name)) {
        return callback(new Error('no such profile: ' + name));
    }
    this.defaultProfileName = this.config.defaultProfile = name;
    common.saveConfigSync(this.config);
    callback();
};

Joyent.prototype.getProfile = function getProfile(name) {
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
Joyent.prototype.createOrUpdateProfile = function createOrUpdateProfile(
        profile, options, callback) {
    assert.object(profile, 'profile');
    if (typeof(options) === 'function') {
        callback = options;
        options = {};
    }
    assert.object(options, 'options')
    assert.optionalBool(options.setDefault, 'options.setDefault')
    assert.func(callback, 'callback')

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

Joyent.prototype.deleteProfile = function deleteProfile(name, callback) {
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


Joyent.prototype._clientFromDc = function _clientFromDc(dc) {
    assert.string(dc, 'dc');

    if (!this._clientFromDcCache) {
        this._clientFromDcCache = {};
    }
    if (!this._clientFromDcCache[dc]) {
        var prof = this.profile;
        var sign;
        if (prof.privKey) {
            sign = smartdc.privateKeySigner({
                user: prof.account,
                keyId: prof.keyId,
                key: prof.privKey
            });
        } else {
            sign = smartdc.cliSigner({keyId: prof.keyId, user: prof.account});
        }
        var client = smartdc.createClient({
            url: this.config.dcs[dc],
            account: prof.account,
            version: '*',
            noCache: true, //XXX
            rejectUnauthorized: Boolean(prof.rejectUnauthorized),
            sign: sign,
            // XXX cloudapi.js stupidly uses its own logger, but takes logLevel
            logLevel: this.log && this.log.level(),
            // Pass our logger to underlying restify client.
            log: this.log
        });
        this._clientFromDcCache[dc] = client;
    }
    return this._clientFromDcCache[dc];
};



/**
 * List machines for the current profile.
 *
 * @param {Object} options  Optional
 *      - {Function} onDcError  `function (dc, err)` called for each DC client
 *        error.
 */
Joyent.prototype.listMachines = function listMachines(options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {}
    }
    assert.object(options, 'options');
    assert.optionalFunc(options.onDcError, 'options.onDcError');
    assert.func(callback, 'callback');

    var allMachines = [];
    async.each(
        self.profile.dcs || Object.keys(self.config.dcs),
        function oneDc(dc, next) {
            var client = self._clientFromDc(dc);
            client.listMachines(function (err, machines) {
                if (err) {
                    if (options.onDcError) {
                        options.onDcError(dc, err);
                    }
                } else {
                    for (var i = 0; i < machines.length; i++) {
                        machines[i].dc = dc;
                        allMachines.push(machines[i]);
                    }
                }
                next();
            });
        },
        function done(err) {
            callback(err, allMachines);
        }
    );
};



//---- exports

module.exports = Joyent;
