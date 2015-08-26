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


var DEFAULT_USER_CONFIG_PATH = path.resolve(process.env.HOME, '.triton', 'config.json');
var DEFAULTS_PATH = path.resolve(__dirname, '..', 'etc', 'defaults.json');
var OVERRIDE_KEYS = []; // config object keys to do a one-level deep override

/**
 * Load the Triton client config. This is a merge of the built-in "defaults" (at
 * etc/defaults.json) and the "user" config (at ~/.triton/config.json if it
 * exists).
 *
 * This includes some internal data on keys with a leading underscore.
 */
function loadConfigSync(configPath) {
    var c = fs.readFileSync(DEFAULTS_PATH, 'utf8');
    var _defaults = JSON.parse(c);
    var config = JSON.parse(c);
    if (configPath && fs.existsSync(configPath)) {
        c = fs.readFileSync(configPath, 'utf8');
        var _user = JSON.parse(c);
        var userConfig = JSON.parse(c);
        if (typeof(userConfig) !== 'object' || Array.isArray(userConfig)) {
            throw new errors.ConfigError(
                sprintf('"%s" is not an object', configPath));
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
    //XXX Add TRITON_* envvars.
    config.profiles.push({
        name: 'env',
        account: process.env.SDC_USER || process.env.SDC_ACCOUNT,
        url: process.env.SDC_URL,
        keyId: process.env.SDC_KEY_ID,
        insecure: common.boolFromString(process.env.SDC_TESTING)
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
    DEFAULT_USER_CONFIG_PATH: DEFAULT_USER_CONFIG_PATH,
    loadConfigSync: loadConfigSync
};
// vim: set softtabstop=4 shiftwidth=4:
