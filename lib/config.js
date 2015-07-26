#!/usr/bin/env node
/**
 * Copyright (c) 2014 Joyent Inc. All rights reserved.
 */

var p = console.log;
var assert = require('assert-plus');
var fs = require('fs');
var path = require('path');
var sprintf = require('extsprintf').sprintf;

var common = require('./common');
var errors = require('./errors');


var CONFIG_PATH = path.resolve(process.env.HOME, '.sdcconfig.json');
var DEFAULTS_PATH = path.resolve(__dirname, '..', 'etc', 'defaults.json');
var OVERRIDE_KEYS = ['dc', 'dcAlias'];


/**
 * Load the 'sdc' config. This is a merge of the built-in "defaults" (at
 * etc/defaults.json) and the "user" config (at ~/.sdcconfig.json if it
 * exists).
 *
 * This includes some internal data on keys with a leading underscore.
 */
function loadConfigSync() {
    var c = fs.readFileSync(DEFAULTS_PATH, 'utf8');
    var _defaults = JSON.parse(c);
    var config = JSON.parse(c);
    if (fs.existsSync(CONFIG_PATH)) {
        c = fs.readFileSync(CONFIG_PATH, 'utf8');
        var _user = JSON.parse(c);
        var userConfig = JSON.parse(c);
        if (typeof(userConfig) !== 'object' || Array.isArray(userConfig)) {
            throw new errors.ConfigError(
                sprintf('"%s" is not an object', CONFIG_PATH));
        }
        // These special keys are merged into the key of the same name in the
        // base "defaults.json".
        Object.keys(userConfig).forEach(function (key) {
            if (~OVERRIDE_KEYS.indexOf(key) && config[key] !== undefined) {
                Object.keys(userConfig[key]).forEach(function (subKey) {
                    if (userConfig[key][subKey] === null) {
                        delete config[key][subKey];
                    } else {
                        config[key][subKey] = userConfig[key][subKey];
                    }
                });
            } else {
                config[key] = userConfig[key];
            }
        });

        config._user = _user;
    }
    config._defaults = _defaults;

    // Add 'env' profile.
    if (!config.profiles) {
        config.profiles = [];
    }
    config.profiles.push({
        name: 'env',
        dcs: ['joyent'],
        user: process.env.SDC_USER || process.env.SDC_ACCOUNT,
        keyId: process.env.SDC_KEY_ID,
        rejectUnauthorized: common.boolFromString(
            process.env.SDC_TESTING || process.env.SDC_TLS_INSECURE)
    });

    return config;
}


/**
 * Apply the given key:value updates to the user config and save it out.
 *
 * @param config {Object} The loaded config, as from `loadConfigSync`.
 * @param updates {Object} key/value pairs to update.
 */
function updateUserConfigSync(config, updates) {
    XXX
    ///XXX START HERE: to implement for 'sdc dcs add foo bar'
}


//---- exports

module.exports = {
    CONFIG_PATH: CONFIG_PATH,
    loadConfigSync: loadConfigSync,
    //XXX
    //updateConfigSync: updateConfigSync
};
// vim: set softtabstop=4 shiftwidth=4:
