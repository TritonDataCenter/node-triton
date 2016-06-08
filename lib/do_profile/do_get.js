/*
 * Copyright 2016 Joyent Inc.
 *
 * `triton profile get ...`
 */

var assert = require('assert-plus');

var errors = require('../errors');
var mod_config = require('../config');


function _showProfile(opts, cb) {
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

    if (profile.name === cli.tritonapi.profile.name) {
        cli._applyProfileOverrides(profile);
        profile.curr = true;
    } else {
        profile.curr = false;
    }

    if (opts.json) {
        console.log(JSON.stringify(profile));
    } else {
        console.log('name: %s', profile.name);
        Object.keys(profile).sort().forEach(function (key) {
            if (key === 'name')
                return;
            if (profile[key] !== undefined)
                console.log('%s: %s', key, profile[key]);
        });
    }
}


function do_get(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    _showProfile({
        cli: this.top,
        name: args[0] || this.top.tritonapi.profile.name,
        json: opts.json
    }, cb);
}

do_get.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_get.synopses = ['{{name}} {{cmd}} [PROFILE]'];
do_get.help = [
    'Get a Triton CLI profile.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'If NAME is not specified, the current profile is shown.'
].join('\n');

do_get.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_get;
