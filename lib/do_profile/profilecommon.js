/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * Shared stuff for `triton profile ...` handling.
 */

var assert = require('assert-plus');

var mod_config = require('../config');



function setCurrentProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        return cb(err);
    }

    if (cli.tritonapi.profile.name === profile.name) {
        console.log('"%s" is already the current profile', profile.name);
        return cb();
    }

    mod_config.setConfigVar({
        configDir: cli.configDir,
        name: 'profile',
        value: profile.name
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
