/*
 * Copyright 2016 Joyent Inc.
 *
 * Shared stuff for `triton profile ...` handling.
 */

var assert = require('assert-plus');

var mod_config = require('../config');
var errors = require('../errors');


function setCurrentProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    if (opts.name === '-') {
        if (cli.tritonapi.config.hasOwnProperty('oldProfile')) {
            opts.name = cli.tritonapi.config.oldProfile;
        } else {
            cb(new errors.ConfigError('"oldProfile" is not set in config'));
            return;
        }
    }

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        return cb(err);
    }

    var currProfile;
    try {
        currProfile = cli.tritonapi.profile;
    } catch (err) {
        // Ignore inability to load a profile.
        if (!(err instanceof errors.ConfigError)) {
            throw err;
        }
    }
    if (currProfile && currProfile.name === profile.name) {
        console.log('"%s" is already the current profile', profile.name);
        return cb();
    }

    mod_config.setConfigVars({
        configDir: cli.configDir,
        vars: {
            profile: profile.name
        }
    }, function (err) {
        if (err) {
            return cb(err);
        }
        console.log('Set "%s" as current profile', profile.name);
        cb();
    });
}


module.exports = {
    setCurrentProfile: setCurrentProfile
};
