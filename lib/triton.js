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
 * Find a machine in the set of DCs for the current profile.
 *
 *
 * @param {Object} options
 *      - {String} machine (required) The machine id.
 *        XXX support name matching, prefix, etc.
 * @param {Function} callback  `function (err, machine, dc)`
 *      Returns the machine object (as from cloudapi GetMachine) and the `dc`,
 *      e.g. "us-west-1".
 */
Triton.prototype.findMachine = function findMachine(options, callback) {
    //XXX Eventually this can be cached for a *full* uuid. Arguably for a
    //  uuid prefix or machine alias match, it cannot be cached, because an
    //  ambiguous machine could have been added.
    var self = this;
    assert.object(options, 'options');
    assert.string(options.machine, 'options.machine');
    assert.func(callback, 'callback');
    var callback = once(callback);

    var errs = [];
    var foundMachine;
    var foundDc;
    async.each(
        self.dcs(),
        function oneDc(dc, next) {
            var client = self._clientFromDc(dc.name);
            client.getMachine({id: options.machine}, function (err, machine) {
                if (err) {
                    errs.push(err);
                } else if (machine) {
                    foundMachine = machine;
                    foundDc = dc.name;
                    // Return early on an unambiguous match.
                    // XXX When other than full 'id' is supported, this isn't unambiguous.
                    callback(null, foundMachine, foundDc);
                }
                next();
            });
        },
        function done(surpriseErr) {
            if (surpriseErr) {
                callback(surpriseErr);
            } else if (foundMachine) {
                callback(null, foundMachine, foundDc)
            } else if (errs.length) {
                callback(errs.length === 1 ?
                    errs[0] : new errors.MultiError(errs));
            } else {
                callback(new errors.InternalError(
                    'unexpected error finding machine ' + options.id));
            }
        }
    );
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
Triton.prototype.listMachines = function listMachines(options) {
    var self = this;
    if (options === undefined) {
        options = {};
    }
    assert.object(options, 'options');

    var emitter = new EventEmitter();
    async.each(
        self.dcs(),
        function oneDc(dc, next) {
            var client = self._clientFromDc(dc.name);
            client.listMachines(function (err, machines) {
                if (err) {
                    emitter.emit('dcError', dc.name, err);
                } else {
                    emitter.emit('data', dc.name, machines);
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


/**
 * Return the audit for the given machine.
 *
 * @param {Object} options
 *      - {String} machine (required) The machine id.
 *        XXX support `machine` being more than just the UUID.
 * @param {Function} callback of the form `function (err, audit, dc)`
 */
Triton.prototype.machineAudit = function machineAudit(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.machine, 'options.machine');

    self.findMachine({machine: options.machine}, function (err, machine, dc) {
        if (err) {
            return callback(err);
        }
        var client = self._clientFromDc(dc);
        client.machineAudit({id: machine.id}, function (err, audit) {
            callback(err, audit, dc);
        });
    });
};



//---- exports

module.exports = Triton;
