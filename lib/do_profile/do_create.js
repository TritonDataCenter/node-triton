/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * `triton profile create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var sshpk = require('sshpk');
var vasync = require('vasync');
var auth = require('smartdc-auth');
var wordwrap = require('wordwrap');

var common = require('../common');
var errors = require('../errors');
var mod_config = require('../config');
var profilecommon = require('./profilecommon');


function _createProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.optionalString(opts.file, 'opts.file');
    assert.optionalString(opts.copy, 'opts.copy');
    assert.optionalBool(opts.noDocker, 'opts.noDocker');
    assert.optionalBool(opts.yes, 'opts.yes');
    assert.func(cb, 'cb');
    var cli = opts.cli;
    var log = cli.log;

    var data;
    var wrap80 = wordwrap(Math.min(process.stdout.columns, 80));

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
        function determineInputType(ctx, next) {
            /*
             * Are we gathering profile data from stdin, a file, or
             * interactively?
             */
            if (opts.file === '-') {
                ctx.inputType = 'stdin';
            } else if (opts.file) {
                ctx.inputType = 'file';
            } else if (!process.stdin.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create profile: stdin is not a TTY'));
            } else if (!process.stdout.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create profile: stdout is not a TTY'));
            } else {
                ctx.inputType = 'interactive';
            }
            next();
        },
        function gatherDataStdin(ctx, next) {
            if (ctx.inputType !== 'stdin') {
                next();
                return;
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
            if (ctx.inputType !== 'file') {
                next();
                return;
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

        function interactiveGatherKeyChoices(ctx, next) {
            if (ctx.inputType !== 'interactive') {
                next();
                return;
            }

            /*
             * The description of the `keyId` field includes discovered SSH keys
             * for this user.
             */
            var kr = new auth.KeyRing();
            ctx.keyChoices = [];

            kr.list(function (err, pairs) {
                if (err) {
                    next(err);
                    return;
                }
                Object.keys(pairs).forEach(function (keyId) {
                    var valid = pairs[keyId].filter(function (kp) {
                        return (kp.canSign());
                    });
                    if (valid.length < 1)
                        return;

                    ctx.keyChoices.push({
                        keyId: keyId,
                        keyPairs: pairs[keyId],
                        pubKey: valid[0].getPublicKey()
                    });
                });
                next();
            });
        },

        function gatherDataInteractive(ctx, next) {
            if (ctx.inputType !== 'interactive') {
                next();
                return;
            }

            var defaults = {};
            if (ctx.copy) {
                defaults = ctx.copy;
                delete defaults.name; // we don't copy a profile name
            } else {
                defaults.url = 'https://us-sw-1.api.joyent.com';
            }

            /*
             * The description of the `keyId` field includes discovered SSH keys
             * for this user.
             */
            var keyIdDesc = 'The fingerprint of the SSH key you want to use ' +
                    'to authenticate with CloudAPI.\n' +
                'Specify the fingerprint or the index of one of the found ' +
                    'keys in the list\n' +
                'below. If the key you want to use is not listed, make sure ' +
                    'it is either saved\n' +
                'in your SSH keys directory (~/.ssh) or loaded into your ' +
                    'SSH agent.\n';
            if (ctx.keyChoices.length === 0) {
                keyIdDesc += '\n(No SSH keys were found.)\n';
            } else {
                var n = 1;
                ctx.keyChoices.forEach(function (keyChoice) {
                    keyIdDesc += format('\n%d. Fingerprint "%s" (%s-bit %s)\n',
                        n, keyChoice.keyId, keyChoice.pubKey.size,
                        keyChoice.pubKey.type.toUpperCase());
                    keyChoice.keyPairs.forEach(function (kp) {
                        var lockedStr = (kp.isLocked() ? ' (locked)' : '');
                        var comment = kp.comment || kp.getPublicKey().comment;
                        var detailsStr;
                        switch (kp.plugin) {
                        case 'agent':
                            detailsStr = comment;
                            break;
                        case 'homedir':
                            detailsStr = format('$HOME/.ssh/%s (comment "%s")',
                                kp.source, comment);
                            break;
                        default:
                            detailsStr = format('%s %s',
                                comment, (kp.source || ''));
                            break;
                        }
                        keyIdDesc += format('   - in %s%s: %s\n',
                            kp.plugin, lockedStr, detailsStr);
                    });
                    n++;
                });
            }

            var fields = [ {
                desc: 'A profile name. A short string to identify this ' +
                    'profile to the `triton` command.',
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
                desc: keyIdDesc,
                key: 'keyId',
                default: defaults.keyId,
                validate: function validateKeyId(value, valCb) {
                    // First try as a fingerprint.
                    try {
                        sshpk.parseFingerprint(value);
                        return valCb();
                    } catch (fpErr) {
                    }

                    // Try as a list index.
                    var idx = Number(value) - 1;
                    if (ctx.keyChoices[idx] !== undefined) {
                        var keyId = ctx.keyChoices[idx].keyId;
                        console.log('Using key %s: %s', value, keyId);
                        return valCb(null, keyId);
                    }

                    valCb(new Error(format(
                        '"%s" is neither a valid fingerprint, nor an index ' +
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
                        console.log('\n');

                    common.promptField(field, function (err, value) {
                        data[field.key] = value;
                        nextField(err);
                    });
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

            console.log(common.ansiStylizeTty('\n\n# Docker setup\n', 'bold'));
            console.log(wrap80('This section will setup authentication to ' +
                'Triton DataCenter\'s Docker endpoint using your account ' +
                'and key information specified above. This is only required ' +
                'if you intend to use `docker` with this profile.\n'));

            profilecommon.profileDockerSetup({
                cli: cli,
                name: data.name,
                keyPaths: ctx.keyPaths,
                implicit: true,
                yes: opts.yes
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
        noDocker: opts.no_docker,
        yes: opts.yes
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
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer yes to any confirmations.'
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
