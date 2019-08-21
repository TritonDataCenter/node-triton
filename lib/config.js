/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * This module provides functions to read and write (a) a TritonApi config
 * and (b) TritonApi profiles.
 *
 * The config is a JSON object loaded from "etc/defaults.json" (shipped with
 * node-triton) plus possibly overrides from "$configDir/config.json" --
 * which is "~/.triton/config.json" for the `triton` CLI. The config has
 * a strict set of allowed keys.
 *
 * A profile is a small object that includes the necessary info for talking
 * to a CloudAPI. E.g.:
 *      {
 *          "name": "east1",
 *          "account": "billy.bob",
 *          "keyId": "de:e7:73:9a:aa:91:bb:3e:72:8d:cc:62:ca:58:a2:ec",
 *          "url": "https://us-east-1.api.joyent.com"
 *      }
 *
 * Profiles are stored as separate JSON files in
 * "$configDir/profiles.d/$name.json". Typically `triton profiles ...` is
 * used to manage them. In addition there is the special "env" profile that
 * is constructed from the "SDC_*" environment variables.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');


var DEFAULTS_PATH = path.resolve(__dirname, '..', 'etc', 'defaults.json');
var OVERRIDE_NAMES = []; // config object keys to do a one-level deep override

// TODO: use this const to create the "Configuration" docs table.
var CONFIG_VAR_NAMES = [
    'profile',
    // Intentionally exclude 'oldProfile' so that it isn't manually set.
    // 'oldProfile',
    'cacheDir'
];

// TODO: use this to create a profile doc table?
var PROFILE_FIELDS = {
    name: true,
    url: true,
    account: true,
    keyId: true,
    insecure: true,
    user: true,
    roles: true,
    actAsAccount: true
};


// --- internal support stuff

function configPathFromDir(configDir) {
    return path.resolve(configDir, 'config.json');
}


// --- Config

/**
 * Load the TritonApi config. This is a merge of the built-in "defaults" (at
 * etc/defaults.json) and the "user" config (at "$configDir/config.json",
 * typically "~/.triton/config.json", if it exists).
 *
 * This includes some internal data on keys with a leading underscore:
 *      _defaults       the defaults.json object
 *      _configDir      the user config dir (if one is provided)
 *      _user           the "user" config.json object (if exists)
 *
 * @param opts.configDir {String} Optional. A base dir for TritonApi config.
 * @returns {Object} The loaded config.
 */
function loadConfig(opts) {
    assert.object(opts, 'opts');
    assert.optionalString(opts.configDir, 'opts.configDir');

    var configDir;
    var configPath;
    if (opts.configDir) {
        configDir = common.tildeSync(opts.configDir);
        configPath = configPathFromDir(configDir);
    }

    var c = fs.readFileSync(DEFAULTS_PATH, 'utf8');
    var _defaults = JSON.parse(c);
    var config = JSON.parse(c);
    if (configPath && fs.existsSync(configPath)) {
        c = fs.readFileSync(configPath, 'utf8');
        try {
            var _user = JSON.parse(c);
            var userConfig = JSON.parse(c);
        } catch (userConfigParseErr) {
            throw new errors.ConfigError(
                format('"%s" is invalid JSON', configPath));
        }
        if (typeof (userConfig) !== 'object' || Array.isArray(userConfig)) {
            throw new errors.ConfigError(
                format('"%s" is not an object', configPath));
        }
        // These special keys are merged into the key of the same name in the
        // base "defaults.json".
        Object.keys(userConfig).forEach(function (key) {
            if (~OVERRIDE_NAMES.indexOf(key) && config[key] !== undefined) {
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
    if (configDir) {
        config._configDir = configDir;
    }

    return config;
}


function setConfigVars(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.configDir, 'opts.configDir');
    assert.object(opts.vars, 'opts.vars');
    Object.keys(opts.vars).forEach(function (name) {
        assert.ok(name.indexOf('.') === -1,
            'dotted config name not yet supported');
        assert.ok(CONFIG_VAR_NAMES.indexOf(name) !== -1,
            'unknown config var name: ' + name);
    });

    var configPath = configPathFromDir(opts.configDir);
    var config;

    vasync.pipeline({funcs: [
        function loadExisting(_, next) {
            fs.exists(configPath, function (exists) {
                if (!exists) {
                    config = {};
                    return next();
                }
                fs.readFile(configPath, function (err, data) {
                    if (err) {
                        return next(err);
                    }
                    try {
                        config = JSON.parse(data);
                    } catch (e) {
                        return next(e);
                    }
                    next();
                });
            });
        },

        function mkConfigDir(_, next) {
            fs.exists(opts.configDir, function (exists) {
                if (!exists) {
                    mkdirp(opts.configDir, next);
                } else {
                    next();
                }
            });
        },

        /*
         * To support `triton profile set -` to set profile to the *last*
         * one used, we special case the setting of the "profile" config var
         * to *also* then set "oldProfile" to the old value. (We are copying
         * the "OLDPWD" naming used by the shell for `cd -`.)
         */
        function specialCaseOldProfile(_, next) {
            if (opts.vars.hasOwnProperty('profile') && config.profile) {
                opts.vars['oldProfile'] = config.profile;
            }
            next();
        },

        function updateAndSave(_, next) {
            Object.keys(opts.vars).forEach(function (name) {
                config[name] = opts.vars[name];
            });
            fs.writeFile(configPath, JSON.stringify(config, null, 4), next);
        }
    ]}, cb);
}



// --- Profiles

function validateProfile(profile, profilePath) {
    assert.object(profile, 'profile');
    assert.optionalString(profilePath, 'profilePath');

    try {
        assert.string(profile.name, 'profile.name');
        assert.string(profile.url,
            profile.name === 'env' ? 'TRITON_URL or SDC_URL' : 'profile.url');
        assert.string(profile.account,
            profile.name === 'env' ? 'TRITON_ACCOUNT or SDC_ACCOUNT'
                : 'profile.account');
        assert.string(profile.keyId,
            profile.name === 'env' ? 'TRITON_KEY_ID or SDC_KEY_ID'
                : 'profile.keyId');
        assert.optionalBool(profile.insecure,
            profile.name === 'env' ? 'TRITON_TLS_INSECURE or SDC_TLS_INSECURE'
                : 'profile.insecure');
        assert.optionalString(profile.user,
            profile.name === 'env' ? 'TRITON_USER or SDC_USER'
                : 'profile.user');
        assert.optionalString(profile.actAsAccount, 'profile.actAsAccount');
        assert.optionalArrayOfString(profile.roles, 'profile.roles');
    } catch (err) {
        var msg = format('invalid %sprofile%s: %s',
            profile.name ? '"' + profile.name + '" ' : '',
            profilePath ? ' from ' + profilePath: '',
            err.message);
        throw new errors.ConfigError(msg);
    }

    var bogusFields = [];
    Object.keys(profile).forEach(function (field) {
        if (!PROFILE_FIELDS[field]) {
            bogusFields.push(field);
        }
    });
    if (bogusFields.length) {
        throw new errors.ConfigError(format(
            'extraneous fields in "%s" profile: %s%s', profile.name,
            (profilePath ? profilePath + ': ' : ''), bogusFields.join(', ')));
    }
}



/**
 * Load the special 'env' profile, which handles details of getting
 * values from envvars. Typically we'd piggyback on dashdash's env support
 * <https://github.com/trentm/node-dashdash#environment-variable-integration>.
 * However, per the "Environment variable integration" comment in cli.js, we
 * do that manually.
 *
 * @returns {Object} The 'env' profile. If no relevant envvars are set, then
 *      this returns null.
 * @throws {errors.ConfigError} If the profile defined by the environment is
 *      invalid.
 */
function _loadEnvProfile(profileOverrides) {
    var envProfile = {
        name: 'env'
    };

    envProfile.account = process.env.TRITON_ACCOUNT || process.env.SDC_ACCOUNT;
    var user = process.env.TRITON_USER || process.env.SDC_USER;
    if (user) {
        envProfile.user = user;
    }
    envProfile.url = process.env.TRITON_URL || process.env.SDC_URL;
    envProfile.keyId = process.env.TRITON_KEY_ID || process.env.SDC_KEY_ID;
    var actAs = process.env.TRITON_ACT_AS;
    if (actAs) {
        envProfile.actAsAccount = actAs;
    }

    if (process.env.TRITON_TLS_INSECURE) {
        envProfile.insecure = common.boolFromString(
            process.env.TRITON_TLS_INSECURE, undefined, 'TRITON_TLS_INSECURE');
    } else if (process.env.SDC_TLS_INSECURE) {
        envProfile.insecure = common.boolFromString(
            process.env.SDC_TLS_INSECURE, undefined, 'SDC_TLS_INSECURE');
    } else if (process.env.SDC_TESTING) {
        // For compatibility with the legacy behavior of the smartdc
        // tools, *any* set value but the empty string is considered true.
        envProfile.insecure = true;
    }

    for (var attr in profileOverrides) {
        envProfile[attr] = profileOverrides[attr];
    }

    /*
     * If missing any of the required vars, then there is no env profile.
     */
    if (!envProfile.account || !envProfile.url || !envProfile.keyId) {
        return null;
    }
    validateProfile(envProfile, 'environment variables');

    return envProfile;
}

function _profileFromPath(profilePath, name, profileOverrides) {
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
    if (profile.name) {
        throw new errors.ConfigError(format(
            'error in "%s" profile: %s: file must not include "name" field',
            name, profilePath));
    }
    profile.name = name;

    for (var attr in profileOverrides) {
        profile[attr] = profileOverrides[attr];
    }
    validateProfile(profile, profilePath);

    return profile;
}


function loadProfile(opts) {
    assert.string(opts.name, 'opts.name');
    assert.optionalString(opts.configDir, 'opts.configDir');
    assert.optionalObject(opts.profileOverrides, 'opts.profileOverrides');

    if (opts.name === 'env') {
        var envProfile = _loadEnvProfile(opts.profileOverrides);
        if (!envProfile) {
            throw new errors.ConfigError('could not load "env" profile '
                + '(missing TRITON_*, or SDC_*, environment variables)');
        }
        return envProfile;
    } else if (!opts.configDir) {
        throw new errors.ConfigError(
            'cannot load profiles (other than "env") without `opts.configDir`');
    } else {
        var profilePath = path.resolve(
            common.tildeSync(opts.configDir), 'profiles.d',
            opts.name + '.json');
        return _profileFromPath(profilePath, opts.name, opts.profileOverrides);
    }
}

function loadAllProfiles(opts) {
    assert.string(opts.configDir, 'opts.configDir');
    assert.object(opts.log, 'opts.log');
    assert.optionalObject(opts.profileOverrides, 'opts.profileOverrides');

    var profiles = [];

    var envProfile = _loadEnvProfile(opts.profileOverrides);
    if (envProfile) {
        profiles.push(envProfile);
    }

    var d = path.join(common.tildeSync(opts.configDir), 'profiles.d');
    if (fs.existsSync(d)) {
        var files = fs.readdirSync(d);
        files.forEach(function (file) {
            file = path.join(d, file);
            var ext = path.extname(file);
            if (ext !== '.json')
                return;

            var name = path.basename(file).slice(
                0, - path.extname(file).length);
            if (name.toLowerCase() === 'env') {
                // Skip the special 'env'.
                opts.log.warn({profilePath: file},
                    'invalid "env" profile; skipping');
                return;
            }
            try {
                profiles.push(_profileFromPath(file, name));
            } catch (e) {
                opts.log.warn({err: e, profilePath: file},
                    'error loading profile; skipping');
            }
        });
    }

    return profiles;
}

function deleteProfile(opts) {
    assert.string(opts.configDir, 'opts.configDir');
    assert.string(opts.name, 'opts.name');

    if (opts.name === 'env') {
        throw new Error('cannot delete "env" profile');
    }

    var profilePath = path.resolve(opts.configDir, 'profiles.d',
        opts.name + '.json');
    fs.unlinkSync(profilePath);
}

function saveProfileSync(opts) {
    assert.string(opts.configDir, 'opts.configDir');
    assert.object(opts.profile, 'opts.profile');

    var name = opts.profile.name;
    if (name === 'env') {
        throw new Error('cannot save "env" profile');
    }

    validateProfile(opts.profile);

    var toSave = common.objCopy(opts.profile);
    delete toSave.name;

    var profilePath = path.resolve(opts.configDir, 'profiles.d',
        name + '.json');
    if (!fs.existsSync(path.dirname(profilePath))) {
        mkdirp.sync(path.dirname(profilePath));
    }
    fs.writeFileSync(profilePath, JSON.stringify(toSave, null, 4), 'utf8');
    console.log('Saved profile "%s".', name);
}


//---- exports

module.exports = {
    loadConfig: loadConfig,
    setConfigVars: setConfigVars,

    validateProfile: validateProfile,
    loadProfile: loadProfile,
    loadAllProfiles: loadAllProfiles,
    deleteProfile: deleteProfile,
    saveProfileSync: saveProfileSync
};
// vim: set softtabstop=4 shiftwidth=4:
