/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profile create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var sshpk = require('sshpk');
var vasync = require('vasync');
var auth = require('smartdc-auth');

var common = require('../common');
var errors = require('../errors');
var mod_config = require('../config');
var profilecommon = require('./profilecommon');


function _createProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.optionalString(opts.file, 'opts.file');
    assert.optionalString(opts.copy, 'opts.copy');
    assert.optionalBool(opts.noDocker, 'opts.noDocker');
    assert.func(cb, 'cb');
    var cli = opts.cli;
    var log = cli.log;

    var data;

    vasync.pipeline({arg: {}, funcs: [
        function getExistingProfiles(ctx, next) {
            try {
                ctx.profiles = mod_config.loadAllProfiles({
                    configDir: cli.configDir,
                    log: cli.log
                });
            } catch (err) {
                return next(err);
            }
            next();
        },
        function getCopy(ctx, next) {
            if (!opts.copy) {
                return next();
            }
            for (var i = 0; i < ctx.profiles.length; i++) {
                if (ctx.profiles[i].name === opts.copy) {
                    ctx.copy = ctx.profiles[i];
                    break;
                }
            }
            if (!ctx.copy) {
                next(new errors.UsageError(format(
                    'no such profile from which to copy: "%s"', opts.copy)));
            } else {
                next();
            }
        },
        function gatherDataStdin(_, next) {
            if (opts.file !== '-') {
                return next();
            }
            var stdin = '';
            process.stdin.resume();
            process.stdin.on('data', function (chunk) {
                stdin += chunk;
            });
            process.stdin.on('end', function () {
                try {
                    data = JSON.parse(stdin);
                } catch (err) {
                    log.trace({stdin: stdin}, 'invalid profile JSON on stdin');
                    return next(new errors.TritonError(
                        format('invalid profile JSON on stdin: %s', err)));
                }
                next();
            });
        },
        function gatherDataFile(ctx, next) {
            if (!opts.file || opts.file === '-') {
                return next();
            }
            ctx.filePath = opts.file;
            var input = fs.readFileSync(opts.file);
            try {
                data = JSON.parse(input);
            } catch (err) {
                return next(new errors.TritonError(format(
                    'invalid profile JSON in "%s": %s', opts.file, err)));
            }
            next();
        },
        function gatherDataInteractive(ctx, next) {
            if (opts.file) {
                return next();
            } else if (!process.stdin.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create profile: stdin is not a TTY'));
            } else if (!process.stdout.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create profile: stdout is not a TTY'));
            }

            var kr = new auth.KeyRing();
            var keyChoices = {};

            var defaults = {};
            if (ctx.copy) {
                defaults = ctx.copy;
                delete defaults.name; // we don't copy a profile name
            } else {
                defaults.url = 'https://us-sw-1.api.joyent.com';
            }

            var fields = [ {
                desc: 'A profile name. A short string to identify a ' +
                    'CloudAPI endpoint to the `triton` CLI.',
                key: 'name',
                default: defaults.name,
                validate: function validateName(value, valCb) {
                    var regex = /^[a-z][a-z0-9_.-]*$/;
                    if (!regex.test(value)) {
                        return valCb(new Error('Must start with a lowercase ' +
                            'letter followed by lowercase letters, numbers ' +
                            'and "_", "." and "-".'));
                    }
                    for (var i = 0; i < ctx.profiles.length; i++) {
                        if (ctx.profiles[i].name === value) {
                            return valCb(new Error(format(
                                'Profile "%s" already exists.', value)));
                        }
                    }
                    valCb();
                }
            }, {
                desc: 'The CloudAPI endpoint URL.',
                default: defaults.url,
                key: 'url'
                // TODO: shortcut to allow 'ssh nightly1' to have this ssh
                // in and find cloudapi for me
            }, {
                desc: 'Your account login name.',
                key: 'account',
                default: defaults.account,
                validate: function validateAccount(value, valCb) {
                    var regex = /^[^\\]{3,}$/;
                    if (value.length < 3) {
                        return valCb(new Error(
                            'Must be at least 3 characters'));
                    }
                    if (!regex.test(value)) {
                        return valCb(new Error('Must not container a "\\"'));
                    }
                    valCb();
                }
            }, {
                desc: 'The fingerprint of the SSH key you want to use, or ' +
                    'its index in the list above. If the key you want to ' +
                    'use is not listed, make sure it is either saved in your ' +
                    'SSH keys directory or loaded into the SSH agent.',
                key: 'keyId',
                validate: function validateKeyId(value, valCb) {
                    // First try as a fingerprint.
                    try {
                        sshpk.parseFingerprint(value);
                        return valCb();
                    } catch (fpErr) {
                    }

                    // Try as a list index
                    if (keyChoices[value] !== undefined) {
                        return valCb(null, keyChoices[value]);
                    }

                    valCb(new Error(format(
                        '"%s" is neither a valid fingerprint, not an index ' +
                        'from the list of available keys', value)));
                }
            } ];

            data = {};

            /*
             * There are some value profile fields that we don't yet prompt
             * for -- because they are experimental, optional, or I'm just
             * unsure about adding them yet. :) We should still *copy* those
             * over for a `triton profile create --copy ...`.
             *
             * Eventually the need for this block should go away.
             */
            if (ctx.copy) {
                var promptKeys = fields.map(
                    function (field) { return field.key; });
                Object.keys(ctx.copy).forEach(function (key) {
                    if (promptKeys.indexOf(key) === -1) {
                        data[key] = ctx.copy[key];
                    }
                });
            }

            vasync.forEachPipeline({
                inputs: fields,
                func: function getField(field, nextField) {
                    if (field.key !== 'name')
                        console.log();
                    if (field.key === 'keyId') {
                        kr.list(function (err, pairs) {
                            if (err) {
                                nextField(err);
                                return;
                            }
                            var choice = 1;
                            console.log('Available SSH keys:');
                            Object.keys(pairs).forEach(function (keyId) {
                                var valid = pairs[keyId].filter(function (kp) {
                                    return (kp.canSign());
                                });
                                if (valid.length < 1)
                                    return;
                                var pub = valid[0].getPublicKey();
                                console.log(
                                    ' %d. %d-bit %s key with fingerprint %s',
                                    choice, pub.size, pub.type.toUpperCase(),
                                    keyId);
                                pairs[keyId].forEach(function (kp) {
                                    var comment = kp.comment ||
                                        kp.getPublicKey().comment;
                                    console.log('  * [in %s] %s %s %s',
                                        kp.plugin, comment,
                                        (kp.source ? kp.source : ''),
                                        (kp.isLocked() ? '[locked]' : ''));
                                });
                                console.log();
                                keyChoices[choice] = keyId;
                                ++choice;
                            });
                            common.promptField(field, function (err2, value) {
                                data[field.key] = value;
                                nextField(err2);
                            });
                        });
                    } else {
                        common.promptField(field, function (err, value) {
                            data[field.key] = value;
                            nextField(err);
                        });
                    }
                }
            }, function (err) {
                console.log();
                next(err);
            });
        },
        function guardAlreadyExists(ctx, next) {
            for (var i = 0; i < ctx.profiles.length; i++) {
                if (data.name === ctx.profiles[i].name) {
                    return next(new errors.TritonError(format(
                        'profile "%s" already exists', data.name)));
                }
            }
            next();
        },
        function validateIt(ctx, next) {
            // We ignore 'curr'. For now at least.
            delete data.curr;

            try {
                mod_config.validateProfile(data, ctx.filePath);
            } catch (err) {
                return next(err);
            }
            next();
        },
        function saveIt(_, next) {
            try {
                mod_config.saveProfileSync({
                    configDir: cli.configDir,
                    profile: data
                });
            } catch (err) {
                return next(err);
            }
            next();
        },

        function dockerSetup(ctx, next) {
            if (opts.noDocker || process.platform === 'win32') {
                next();
                return;
            }

            profilecommon.profileDockerSetup({
                cli: cli,
                name: data.name,
                keyPaths: ctx.keyPaths,
                implicit: true
            }, next);
        },

        function setCurrIfTheOnlyProfile(ctx, next) {
            if (ctx.profiles.length !== 0) {
                next();
                return;
            }

            mod_config.setConfigVars({
                configDir: cli.configDir,
                vars: {
                    profile: data.name
                }
            }, function (err) {
                if (err) {
                    next(err);
                    return;
                }
                console.log('\nSet "%s" as current profile (because it is ' +
                    'your only profile).', data.name);
                next();
            });
        }
    ]}, cb);
}



function do_create(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        return cb(new errors.UsageError('too many arguments'));
    } else if (opts.copy && opts.file) {
        return cb(new errors.UsageError(
            'cannot specify --file and --copy at the same time'));
    }

    _createProfile({
        cli: this.top,
        file: opts.file,
        copy: opts.copy,
        noDocker: opts.no_docker
    }, cb);
}

do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['file', 'f'],
        type: 'string',
        helpArg: 'FILE',
        help: 'A JSON file (of the same form as "triton profile get -j") ' +
            'with the profile, or "-" to read JSON from stdin.'
    },
    {
        names: ['copy'],
        type: 'string',
        helpArg: 'PROFILE',
        help: 'A profile from which to copy values.',
        completionType: 'tritonprofile'
    },
    {
        names: ['no-docker'],
        type: 'bool',
        help: 'As of Triton CLI 4.9, creating a profile will attempt (on '
            + 'non-Windows) to also setup for running Docker. This is '
            + 'experimental and might fail. Use this option to disable '
            + 'the attempt.'
    }
];


do_create.synopses = ['{{name}} {{cmd}} [OPTIONS]'];
do_create.help = [
    'Create a Triton CLI profile.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Examples:',
    '    triton profile create              # interactively create a profile',
    '    triton profile create --copy env   # ... copying from "env" profile',
    '',
    '    # Or non-interactively create from stdin or a file:',
    '    cat a-profile.json | triton profile create -f -',
    '    triton profile create -f another-profile.json'
].join('\n');


module.exports = do_create;
