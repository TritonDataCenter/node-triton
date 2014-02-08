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


var CONFIG_PATH = path.resolve(process.env.HOME, '.joyentcloudconfig.json');
var DEFAULTS_PATH = path.resolve(__dirname, '..', 'etc', 'defaults.json');


function loadConfigSync() {
    var config = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    if (fs.existsSync(CONFIG_PATH)) {
        var userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        common.objCopy(userConfig, config);
    }

    // Add 'env' profile.
    if (!config.profiles) {
        config.profiles = [];
    }
    config.profiles.push({
        name: 'env',
        account: process.env.SDC_USER || process.env.SDC_ACCOUNT,
        keyId: process.env.SDC_KEY_ID,
        rejectUnauthorized: common.boolFromString(
            process.env.SDC_TESTING || process.env.SDC_TLS_INSECURE)
    });

    return config;
}



//---- exports

module.exports = {
    CONFIG_PATH: CONFIG_PATH,
    loadConfigSync: loadConfigSync
};
// vim: set softtabstop=4 shiftwidth=4:
