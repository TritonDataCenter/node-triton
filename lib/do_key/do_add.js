/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton key add ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var sshpk = require('sshpk');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_add(subcmd, opts, args, cb) {
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing FILE argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var filePath = args[0];
    var cli = this.top;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function gatherDataStdin(ctx, next) {
            if (filePath !== '-') {
                return next();
            }

            var stdin = '';
            process.stdin.resume();
            process.stdin.on('data', function (chunk) {
                stdin += chunk;
            });

            process.stdin.on('end', function () {
                ctx.data = stdin;
                ctx.from = '<stdin>';
                next();
            });
        },
        function gatherDataFile(ctx, next) {
            if (!filePath || filePath === '-') {
                return next();
            }

            ctx.data = fs.readFileSync(filePath);
            ctx.from = filePath;
            next();
        },
        function validateData(ctx, next) {
            try {
                sshpk.parseKey(ctx.data, 'ssh', ctx.from);
            } catch (keyErr) {
                next(keyErr);
                return;
            }

            next();
        },
        function createIt(ctx, next) {
            var createOpts = {
                userId: opts.userId,
                key: ctx.data.toString('utf8')
            };

            if (opts.name) {
                createOpts.name = opts.name;
            }

            cli.tritonapi.cloudapi.createKey(createOpts, function (err, key) {
                if (err) {
                    next(err);
                    return;
                }

                if (key.name) {
                    console.log('Added key "%s" (%s)',
                        key.name, key.fingerprint);
                } else {
                    console.log('Added key %s', key.fingerprint);
                }

                next();
            });
        }
    ]}, cb);
}


do_add.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {
        names: ['name', 'n'],
        type: 'string',
        helpArg: 'NAME',
        help: 'An optional name for an added key.'
    }
];

do_add.synopses = ['{{name}} {{cmd}} [OPTIONS] FILE'];

do_add.help = [
    'Add an SSH key to an account.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "FILE" must be a file path to an SSH public key, ',
    'or "-" to pass the public key in on stdin.'
].join('\n');

module.exports = do_add;
