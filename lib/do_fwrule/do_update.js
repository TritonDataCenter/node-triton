/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton fwrule update ...`
 */

var format = require('util').format;
var fs = require('fs');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var UPDATE_FWRULE_FIELDS =
    require('../cloudapi2').CloudApi.prototype.UPDATE_FWRULE_FIELDS;


function do_update(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    var log = this.log;
    var tritonapi = this.top.tritonapi;

    if (args.length === 0) {
        cb(new errors.UsageError('missing FWRULE argument'));
        return;
    }

    var id = args.shift();

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
                    typeHintFromKey: UPDATE_FWRULE_FIELDS
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
                    'invalid JSON for firewall rule update in "%s": %s',
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
                        'invalid firewall rule update JSON on stdin');
                    next(new errors.TritonError(format(
                        'invalid JSON for firewall rule update on stdin: %s',
                        err)));
                    return;
                }
                next();
            });
        },

        function validateIt(ctx, next) {
            try {
                common.validateObject(ctx.data, UPDATE_FWRULE_FIELDS);
            } catch (e) {
                next(e);
                return;
            }

            next();
        },

        function updateAway(ctx, next) {
            var data = ctx.data;
            data.id = id;

            tritonapi.updateFirewallRule(data, function (err) {
                if (err) {
                    next(err);
                    return;
                }

                delete data.id;
                console.log('Updated firewall rule %s (fields: %s)', id,
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
    '{{name}} {{cmd}} FWRULE [FIELD=VALUE ...]',
    '{{name}} {{cmd}} -f JSON-FILE FWRULE'
];
do_update.help = [
    'Update a firewall rule',
    '',
    '{{usage}}',
    '',
    '{{options}}',

    'Updateable fields:',
    '    ' + Object.keys(UPDATE_FWRULE_FIELDS).sort().map(function (f) {
        return f + ' (' + UPDATE_FWRULE_FIELDS[f] + ')';
    }).join('\n    '),
    '',
    'Where FWRULE is a firewall rule id (full UUID) or short id.'
].join('\n');

do_update.completionArgtypes = ['tritonfwrule', 'tritonupdatefwrulefield'];

module.exports = do_update;
