/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var glob = require('glob');
var path = require('path');

var common = require('./common');
var errors = require('./errors');


var DEFAULTS_PATH = path.resolve(__dirname, '..', 'etc', 'defaults.json');
var OVERRIDE_KEYS = []; // config object keys to do a one-level deep override


// --- internal support stuff

// TODO: improve this validation
function _validateProfile(profile) {
    assert.object(profile, 'profile');
    assert.string(profile.name, 'profile.name');
    assert.string(profile.url, 'profile.url');
    assert.string(profile.account, 'profile.account');
    assert.string(profile.keyId, 'profile.keyId');
    assert.optionalBool(profile.insecure, 'profile.insecure');
    // TODO: error on extraneous params
}



// --- exported functions

/**
 * Load the TritonApi config. This is a merge of the built-in "defaults" (at
 * etc/defaults.json) and the "user" config (at "$configDir/config.json",
 * typically "~/.triton/config.json", if it exists).
 *
 * This includes some internal data on keys with a leading underscore:
 *      _defaults       the defaults.json object
 *      _user           the "user" config.json object
 *      _configDir      the user config dir
 *
 * @returns {Object} The loaded config.
 */
function loadConfig(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.configDir, 'opts.configDir');

    var configPath = path.resolve(opts.configDir, 'config.json');

    var c = fs.readFileSync(DEFAULTS_PATH, 'utf8');
    var _defaults = JSON.parse(c);
    var config = JSON.parse(c);
    if (fs.existsSync(configPath)) {
        c = fs.readFileSync(configPath, 'utf8');
        var _user = JSON.parse(c);
        var userConfig = JSON.parse(c);
        if (typeof (userConfig) !== 'object' || Array.isArray(userConfig)) {
            throw new errors.ConfigError(
                format('"%s" is not an object', configPath));
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
    config._configDir = opts.configDir;

    return config;
}


/**
 * Load the special 'env' profile, which handles some details of getting
 * values from envvars. *Most* of that is done already via the
 * `opts` dashdash Options object.
 *
 * @returns {Object} The 'env' profile.
 */
function loadEnvProfile(opts) {
    // XXX support keyId being a priv or pub key path, a la imgapi-cli
    // XXX Add TRITON_* envvars.
    var envProfile = {
        name: 'env',
        account: opts.account,
        url: opts.url,
        keyId: opts.keyId,
        insecure: opts.insecure
    };
    // If --insecure not given, look at envvar(s) for that.
    var specifiedInsecureOpt = opts._order.filter(
        function (opt) { return opt.key === 'insecure'; }).length > 0;
    if (!specifiedInsecureOpt && process.env.SDC_TESTING) {
        envProfile.insecure = common.boolFromString(
            process.env.SDC_TESTING,
            false, '"SDC_TESTING" envvar');
    }

    _validateProfile(envProfile);

    return envProfile;
}

function _profileFromPath(profilePath, name) {
    if (! fs.existsSync(profilePath)) {
        throw new errors.ConfigError('no such profile: ' + name);
    }
    var profile;
    try {
        profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    } catch (e) {
        throw new errors.ConfigError(e, format(
            'error in "%s" profile: %s: %s', name,
            profilePath, e.message));
    }
    profile.name = name;

    _validateProfile(profile);

    return profile;
}

function loadProfile(opts) {
    assert.string(opts.configDir, 'opts.configDir');
    assert.string(opts.name, 'opts.name');

    var profilePath = path.resolve(opts.configDir, 'profiles.d',
        opts.name + '.json');
    return _profileFromPath(profilePath, opts.name);
}

function loadAllProfiles(opts) {
    assert.string(opts.configDir, 'opts.configDir');
    assert.object(opts.log, 'opts.log');

    var profiles = [];
    var files = glob.sync(path.resolve(opts.configDir,
            'profiles.d', '*.json'));
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var name = path.basename(file).slice(0, - path.extname(file).length);
        if (name.toLowerCase() === 'env') {
            // Skip the special 'env'.
            opts.log.debug('skip reserved name "env" profile: %s', file);
            continue;
        }
        try {
            profiles.push(_profileFromPath(file, name));
        } catch (e) {
            opts.log.warn({err: e, profilePath: file},
                'error loading profile; skipping');
        }
    }

    return profiles;
}


//---- exports

module.exports = {
    loadConfig: loadConfig,
    loadEnvProfile: loadEnvProfile,
    loadProfile: loadProfile,
    loadAllProfiles: loadAllProfiles
};
// vim: set softtabstop=4 shiftwidth=4:
