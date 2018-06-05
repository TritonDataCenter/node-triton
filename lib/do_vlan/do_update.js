/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 *
 * `triton vlan update ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


var UPDATE_VLAN_FIELDS
    = require('../cloudapi2').CloudApi.prototype.UPDATE_VLAN_FIELDS;


function do_update(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    var log = this.log;
    var tritonapi = this.top.tritonapi;

    if (args.length === 0) {
        cb(new errors.UsageError('missing VLAN argument'));
        return;
    }

    var id = args.shift();

    vasync.pipeline({arg: {}, funcs: [
        function gatherDataArgs(ctx, next) {
            if (opts.file) {
                next();
                return;
            }

            try {
                ctx.data = common.objFromKeyValueArgs(args, {
                    disableDotted: true,
                    typeHintFromKey: UPDATE_VLAN_FIELDS
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
                    'invalid JSON for vlan update in "%s": %s',
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

            process.stdin.on('error', console.error);

            process.stdin.on('end', function () {
                try {
                    ctx.data = JSON.parse(stdin);
                } catch (err) {
                    log.trace({stdin: stdin},
                        'invalid VLAN update JSON on stdin');
                    next(new errors.TritonError(format(
                        'invalid JSON for VLAN update on stdin: %s',
                        err)));
                    return;
                }
                next();
            });
        },

        function validateIt(ctx, next) {
            assert.object(ctx.data, 'ctx.data');

            var keys = Object.keys(ctx.data);

            if (keys.length === 0) {
                console.log('No fields given for VLAN update');
                next();
                return;
            }

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var value = ctx.data[key];
                var type = UPDATE_VLAN_FIELDS[key];
                if (!type) {
                    next(new errors.UsageError(format('unknown or ' +
                        'unupdateable field: %s (updateable fields are: %s)',
                        key,
                        Object.keys(UPDATE_VLAN_FIELDS).sort().join(', '))));
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
            var data = ctx.data;
            data.vlan_id = id;

            tritonapi.updateFabricVlan(data, function onUpdate(err) {
                if (err) {
                    next(err);
                    return;
                }

                delete data.vlan_id;
                console.log('Updated vlan %s (fields: %s)', id,
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
    '{{name}} {{cmd}} VLAN [FIELD=VALUE ...]',
    '{{name}} {{cmd}} -f JSON-FILE VLAN'
];

do_update.help = [
    'Update a VLAN.',
    '',
    '{{usage}}',
    '',
    '{{options}}',

    'Updateable fields:',
    '    ' + Object.keys(UPDATE_VLAN_FIELDS).sort().map(function (f) {
        return f + ' (' + UPDATE_VLAN_FIELDS[f] + ')';
    }).join(', '),
    '',
    'Where VLAN is a VLAN id or name.'
].join('\n');

do_update.completionArgtypes = ['tritonvlan', 'tritonupdatevlanfield'];

module.exports = do_update;
