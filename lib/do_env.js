/*
 * Copyright 2016 Joyent Inc.
 *
 * `triton env ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var path = require('path');
var strsplit = require('strsplit');
var sshpk = require('sshpk');
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');
var mod_config = require('./config');



function do_env(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    var profileName = args[0] || this.tritonapi.profile.name;
    var allClientTypes = ['triton', 'docker', 'smartdc'];
    var clientTypes = [];
    var explicit;
    var shortOpts = '';
    if (opts.triton) {
        shortOpts += 't';
        clientTypes.push('triton');
    }
    if (opts.docker) {
        shortOpts += 'd';
        clientTypes.push('docker');
    }
    if (opts.smartdc) {
        shortOpts += 's';
        clientTypes.push('smartdc');
    }
    if (opts.unset) {
        shortOpts += 'u';
    }
    if (clientTypes.length === 0) {
        explicit = false;
        clientTypes = allClientTypes;
    } else {
        explicit = true;
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
    clientTypes.forEach(function (clientType) {
        switch (clientType) {
        case 'triton':
            p('# triton');
            if (opts.unset) {
                [
                    'TRITON_PROFILE',
                    'TRITON_URL',
                    'TRITON_ACCOUNT',
                    'TRITON_USER',
                    'TRITON_KEY_ID',
                    'TRITON_TLS_INSECURE'
                ].forEach(function (key) {
                    p('unset %s', key);
                });
            } else {
                p('export TRITON_PROFILE="%s"', profile.name);
            }
            break;
        case 'docker':
            p('# docker');
            var setupJson = path.resolve(self.configDir, 'docker',
                common.profileSlug(profile), 'setup.json');
            if (fs.existsSync(setupJson)) {
                var setup;
                try {
                    setup = JSON.parse(fs.readFileSync(setupJson));
                } catch (err) {
                    cb(new errors.ConfigError(err, format(
                        'error determining Docker environment from "%s": %s',
                        setupJson, err)));
                    return;
                }
                Object.keys(setup.env).forEach(function (key) {
                    var val = setup.env[key];
                    if (opts.unset || val === null) {
                        p('unset %s', key);
                    } else {
                        p('export %s=%s', key, val);
                    }
                });
            } else if (opts.unset) {
                [
                    'DOCKER_HOST',
                    'DOCKER_CERT_PATH',
                    'DOCKER_TLS_VERIFY',
                    'COMPOSE_HTTP_TIMEOUT'
                ].forEach(function (key) {
                    p('unset %s', key);
                });
            } else if (explicit) {
                cb(new errors.ConfigError(format('could not find Docker '
                    + 'environment setup for profile "%s":\n    Run `triton '
                    + 'profile docker-setup %s` to setup.',
                    profile.name, profile.name)));
            }
            break;
        case 'smartdc':
            p('# smartdc');
            if (opts.unset) {
                [
                    'SDC_URL',
                    'SDC_ACCOUNT',
                    'SDC_USER',
                    'SDC_KEY_ID',
                    'SDC_TESTING'
                ].forEach(function (key) {
                    p('unset %s', key);
                });
            } else {
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
            }
            break;
        default:
            return cb(new errors.InternalError(
                'unknown clientType: ' + clientType));
        }
    });

    p('# Run this command to configure your shell:');
    p('#     eval "$(triton env%s%s)"',
        (shortOpts ? ' -'+shortOpts : ''),
        (profile.name === this.tritonapi.profile.name
            ? '' : ' ' + profile.name));
}

do_env.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: ''
    },
    {
        names: ['triton', 't'],
        type: 'bool',
        help: 'Emit environment commands for node-triton itself (i.e. the ' +
            '"TRITON_PROFILE" variable).'
    },
    {
        names: ['docker', 'd'],
        type: 'bool',
        help: 'Emit environment commands for docker ("DOCKER_HOST" et al).'
    },
    {
        names: ['smartdc', 's'],
        type: 'bool',
        help: 'Emit environment for node-smartdc (i.e. the legacy ' +
            '"SDC_*" variables).'
    },
    {
        group: ''
    },
    {
        names: ['unset', 'u'],
        type: 'bool',
        help: 'Emit environment to *unset* the relevant environment variables.'
    }
];

do_env.synopses = ['{{name}} {{cmd}} [PROFILE]'];

do_env.help = [
    /* BEGIN JSSTYLED */
    'Emit shell commands to setup environment.',
    '',
    'Supported "clients" here are: node-smartdc (i.e. the `sdc-*` tools),',
    'and node-triton itself. By default this emits the environment for all',
    'supported tools. Use options to be specific.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'If no options are given, environment variables are emitted for all ',
    'clients. If PROFILE is not given, the current profile is used.',
    '',
    'The following Bash function can be added to one\'s "~/.bashrc" to quickly',
    'change between Triton profiles:',
    '    triton-select () { eval "$(triton env $1)"; }',
    'for example:',
    '    $ triton-select west1',
    '    $ triton profile get | grep name',
    '    name: west1',
    '    $ triton-select east1',
    '    $ triton profile get | grep name',
    '    name: east1'
    /* END JSSTYLED */
].join('\n');

do_env.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_env;
