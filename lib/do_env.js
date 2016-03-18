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
            p('export TRITON_PROFILE="%s"', profile.name);
            break;
        case 'docker':
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
                    if (val === null) {
                        p('unset %s', key);
                    } else {
                        p('export %s=%s', key, val);
                    }
                });
            } else if (explicit) {
                cb(new errors.ConfigError(format('could not find Docker '
                    + 'environment setup for profile "%s":\n    Run `triton '
                    + 'profile docker-setup %s` to setup.',
                    profile.name, profile.name)));
            }
            break;
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
        help: 'Emit environment for node-smartdc (i.e. the "SDC_*" variables).'
    }
];

// TODO: support env for docker usage.
do_env.help = [
    /* BEGIN JSSTYLED */
    'Emit shell environment commands to setup clients for a particular CLI profile.',
    '',
    'Supported "clients" here are: node-smartdc (i.e. the `sdc-*` tools),',
    'and node-triton itself. By default this emits the environment for all',
    'supported tools. Use options to be specific.',
    '',
    'Usage:',
    '     {{name}} env [PROFILE]',
    '',
    '{{options}}'
    /* END JSSTYLED */
].join('\n');


do_env.hidden = true;

module.exports = do_env;
