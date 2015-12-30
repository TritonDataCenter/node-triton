/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profile create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var sshpk = require('sshpk');
var tilde = require('tilde-expansion');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var mod_config = require('../config');


function _createProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.optionalString(opts.file, 'opts.file');
    assert.optionalString(opts.copy, 'opts.copy');
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

            var defaults = {};
            if (ctx.copy) {
                defaults = ctx.copy;
                delete defaults.name; // we don't copy a profile name
            } else {
                defaults.url = 'https://us-sw-1.api.joyent.com';

                var possibleDefaultFp = '~/.ssh/id_rsa';
                if (fs.existsSync(common.tildeSync(possibleDefaultFp))) {
                    defaults.keyId = possibleDefaultFp;
                }
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
                desc: 'The fingerprint of the SSH key you have registered ' +
                    'for your account. Alternatively, You may enter a local ' +
                    'path to a public or private SSH key to have the ' +
                    'fingerprint calculated for you.',
                default: defaults.keyId,
                key: 'keyId',
                validate: function validateKeyId(value, valCb) {
                    // First try as a fingerprint.
                    try {
                        sshpk.parseFingerprint(value);
                        return valCb();
                    } catch (fpErr) {
                    }

                    // Try as a local path.
                    tilde(value, function (keyPath) {
                        fs.stat(keyPath, function (statErr, stats) {
                            if (statErr || !stats.isFile()) {
                                return valCb(new Error(format(
                                    '"%s" is neither a valid fingerprint, ' +
                                    'nor an existing file', value)));
                            }
                            fs.readFile(keyPath, function (readErr, keyData) {
                                if (readErr) {
                                    return valCb(readErr);
                                }
                                var keyType = (keyPath.slice(-4) === '.pub'
                                    ? 'ssh' : 'pem');
                                try {
                                    var key = sshpk.parseKey(keyData, keyType);
                                } catch (keyErr) {
                                    return valCb(keyErr);
                                }

                                var newVal = key.fingerprint('md5').toString();
                                console.log('Fingerprint: %s', newVal);
                                valCb(null, newVal);
                            });
                        });
                    });
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
                    if (field.key !== 'name') console.log();
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
        function setCurrIfTheOnlyProfile(ctx, next) {
            if (ctx.profiles.length !== 0) {
                next();
                return;
            }

            mod_config.setConfigVar({
                configDir: cli.configDir,
                name: 'profile',
                value: data.name
            }, function (err) {
                if (err) {
                    next(err);
                    return;
                }
                console.log('Set "%s" as current profile (because it is ' +
                    'your only profile)', data.name);
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
        copy: opts.copy
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
        helpArg: 'NAME',
        help: 'A profile from which to copy values.'
    }
];


do_create.help = [
    'Create a Triton CLI profile.',
    '',
    'Usage:',
    '    {{name}} create <options>',
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
