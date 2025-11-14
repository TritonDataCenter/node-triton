/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys update`
 */

var assert = require('assert-plus');
var vasync = require('vasync');
var fs = require('fs');
var format = require('util').format;

var common = require('../common');
var errors = require('../errors');
var UPDATE_ACCESSKEY_FIELDS =
    require('../cloudapi2').CloudApi.prototype.UPDATE_ACCESSKEY_FIELDS;

function do_update(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing ACCESSKEYID argument(s)'));
        return;
    }

    var accessKeyId = args.shift();

    var tritonapi = this.top.tritonapi;
    var log = this.top.log;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        function gatherDataArgs(ctx, next) {
            if (opts.file) {
                next();
                return;
            }

            try {
                ctx.data = common.objFromKeyValueArgs(args, {
                    disableDotted: true,
                    typeHintFromKey: UPDATE_ACCESSKEY_FIELDS
                });
            } catch (err) {
                next(err);
                return;
            }

            next();
        },

        function gatherDataFile(ctx, next) {
            if (!opts.file || opts.file === '-') {
                next();
                return;
            }

            var input = fs.readFileSync(opts.file, 'utf8');

            try {
                ctx.data = JSON.parse(input);
            } catch (err) {
                next(new errors.TritonError(format(
                    'invalid JSON for access key update in "%s": %s',
                    opts.file, err)));
                return;
            }
            next();
        },

        function gatherDataStdin(ctx, next) {
            if (opts.file !== '-') {
                next();
                return;
            }

            common.readStdin(function gotStdin(stdin) {
                try {
                    ctx.data = JSON.parse(stdin);
                } catch (err) {
                    log.trace({stdin: stdin},
                        'invalid access key update JSON on stdin');
                    next(new errors.TritonError(format(
                        'invalid JSON for access key update on stdin: %s',
                        err)));
                    return;
                }
                next();
            });
        },

        function validate(ctx, next) {
            try {
                common.validateObject(ctx.data, UPDATE_ACCESSKEY_FIELDS);
            } catch (e) {
                next(e);
                return;
            }

            next();
        },

        function update(ctx, next) {
            var data = ctx.data;
            data.accessKeyId = accessKeyId;

            tritonapi.cloudapi.updateAccessKey(data, function (err) {
                if (err) {
                    next(err);
                    return;
                }

                delete data.accessKeyId;
                console.log('Updated access key %s (fields: %s)', accessKeyId,
                            Object.keys(data).join(', '));

                next();
            });
        }
    ]}, cb);
}


do_update.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['file', 'f'],
        type: 'string',
        helpArg: 'JSON-FILE',
        help: 'A file holding a JSON file of updates, or "-" to read ' +
            'JSON from stdin.'
    }
];

do_update.synopses = [
    '{{name}} {{cmd}} ACCESSKEYID [OPTIONS] [FIELD=VALUE ...]',
    '{{name}} {{cmd}} -f JSON-FILE ACCESSKEYID'
];

do_update.help = [
    'Update a CloudAPI access key.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');


do_update.help = [
    'Update an access key.',
    '',
    '{{usage}}',
    '',
    '{{options}}',

    'Updateable fields:',
    '    ' + Object.keys(UPDATE_ACCESSKEY_FIELDS).sort().map(function (f) {
        return f + ' (' + UPDATE_ACCESSKEY_FIELDS[f] + ')';
    }).join('\n    ')
].join('\n');

module.exports = do_update;
