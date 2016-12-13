/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton account update ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var UPDATE_ACCOUNT_FIELDS
    = require('../cloudapi2').CloudApi.prototype.UPDATE_ACCOUNT_FIELDS;


function do_update(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var log = this.log;
    var tritonapi = this.top.tritonapi;

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
                    typeHintFromKey: UPDATE_ACCOUNT_FIELDS
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
                    'invalid JSON for account update in "%s": %s',
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
            var stdin = '';
            process.stdin.resume();
            process.stdin.on('data', function (chunk) {
                stdin += chunk;
            });
            process.stdin.on('end', function () {
                try {
                    ctx.data = JSON.parse(stdin);
                } catch (err) {
                    log.trace({stdin: stdin},
                        'invalid account update JSON on stdin');
                    next(new errors.TritonError(format(
                        'invalid JSON for account update on stdin: %s', err)));
                    return;
                }
                next();
            });
        },

        function validateIt(ctx, next) {
            var keys = Object.keys(ctx.data);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var value = ctx.data[key];
                var type = UPDATE_ACCOUNT_FIELDS[key];
                if (!type) {
                    next(new errors.UsageError(format('unknown or ' +
                        'unupdateable field: %s (updateable fields are: %s)',
                        key,
                        Object.keys(UPDATE_ACCOUNT_FIELDS).sort().join(', '))));
                    return;
                }

                if (typeof (value) !== type) {
                    next(new errors.UsageError(format('field "%s" must be ' +
                        'of type "%s", but got a value of type "%s"', key,
                        type, typeof (value))));
                    return;
                }
            }
            next();
        },

        function updateAway(ctx, next) {
            var keys = Object.keys(ctx.data);
            if (keys.length === 0) {
                console.log('No fields given for account update');
                next();
                return;
            }

            tritonapi.cloudapi.updateAccount(ctx.data, function (err) {
                if (err) {
                    next(err);
                    return;
                }
                console.log('Updated account "%s" (fields: %s)',
                    tritonapi.profile.account, keys.join(', '));
                next();
            });
        }
    ]}, callback);
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
        helpArg: 'FILE',
        help: 'A file holding a JSON file of updates, or "-" to read ' +
            'JSON from stdin.'
    }
];

do_update.synopses = [
    '{{name}} {{cmd}} [FIELD=VALUE ...]',
    '{{name}} {{cmd}} -f JSON-FILE'
];

do_update.help = [
    /* BEGIN JSSTYLED */
    'Update account information',
    '',
    '{{usage}}',
    '',
    '{{options}}',

    'Updateable fields:',
    '    ' + Object.keys(UPDATE_ACCOUNT_FIELDS).sort().map(function (field) {
        return field + ' (' + UPDATE_ACCOUNT_FIELDS[field] + ')';
    }).join('\n    '),

    '',
    'Note that because of cross-data center replication of account information, ',
    'an update might not be immediately reflected in a get.'
    /* END JSSTYLED */
].join('\n');

do_update.completionArgtypes = ['tritonupdateaccountfield'];

module.exports = do_update;
