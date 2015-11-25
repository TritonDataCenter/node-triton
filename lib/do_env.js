/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton env ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var sshpk = require('sshpk');
var tilde = require('tilde-expansion');
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');
var mod_config = require('./config');



function do_env(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    var profileName = args[0] || this.tritonapi.profile.name;
    var clientType = 'smartdc';
    if (opts.smartdc) {
        clientType = 'smartdc';
    }

    try {
        var profile = mod_config.loadProfile({
            configDir: this.configDir,
            name: profileName
        });
    } catch (err) {
        return cb(err);
    }
    if (profile.name === this.tritonapi.profile.name) {
        this._applyProfileOverrides(profile);
    }

    var p = console.log;
    switch (clientType) {
    case 'smartdc':
        p('export SDC_URL="%s"', profile.url);
        p('export SDC_ACCOUNT="%s"', profile.account);
        if (profile.user) {
            p('export SDC_USER="%s"', profile.user);
        } else {
            p('unset SDC_USER');
        }
        p('export SDC_KEY_ID="%s"', profile.keyId);
        if (profile.insecure) {
            p('export SDC_TESTING="%s"', profile.insecure);
        } else {
            p('unset SDC_TESTING');
        }
        p('# Run this command to configure your shell:');
        p('#     eval "$(triton env -s %s)"', profile.name);
        break;
    default:
        return cb(new errors.InternalError(
            'unknown clientType: ' + clientType));
    }
}

do_env.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['smartdc', 's'],
        type: 'bool',
        help: 'Emit environment commands for node-smartdc.'
    }
];

do_env.help = [
    /* BEGIN JSSTYLED */
    'Emit shell environment commands to setup clients for a particular CLI profile.',
    '',
    'Supported "clients" here are: node-smartdc (the `sdc-*` tools).',
    'TODO: support for `triton` and `docker`.',
    '',
    'Note: By default this *currently* emits the environment for node-smartdc.',
    'However, automated usage should use `-s` to guaratee that. The default',
    'might change',
    '',
    'Usage:',
    '     {{name}} env [PROFILE]',
    '',
    '{{options}}'
    /* END JSSTYLED */
].join('\n');


do_env.hidden = true;

module.exports = do_env;
