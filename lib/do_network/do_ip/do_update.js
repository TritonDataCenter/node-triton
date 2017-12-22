/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network ip update ...`
 */

var format = require('util').format;
var fs = require('fs');

var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');
var UPDATE_NETWORK_IP_FIELDS
    = require('../../cloudapi2').CloudApi.prototype.UPDATE_NETWORK_IP_FIELDS;

function do_update(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 2) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d)', args.length)));
        return;
    }

    var log = this.log;
    var tritonapi = this.top.tritonapi;
    var updateIpOpts = {
        id: args.shift(),
        ip: args.shift()
    };

    if (args.length === 0 && !opts.file) {
        callback(new errors.UsageError(
            'FIELD=VALUE arguments or "-f FILE" must be specified'));
        return;
    }

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
                    typeHintFromKey: UPDATE_NETWORK_IP_FIELDS
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
                    'invalid JSON for network IP update in "%s": %s',
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
                        'invalid network IP update JSON on stdin');
                    next(new errors.TritonError(format(
                        'invalid JSON for network IP update on stdin: %s',
                        err)));
                    return;
                }
                next();
            });
        },

        function validateIt(ctx, next) {
            try {
                common.validateObject(ctx.data, UPDATE_NETWORK_IP_FIELDS);
            } catch (e) {
                next(e);
                return;
            }

            next();
        },

        function updateNetworkIP(ctx, next) {
            Object.keys(ctx.data).forEach(function (key) {
                updateIpOpts[key] = ctx.data[key];
            });

            tritonapi.updateNetworkIp(updateIpOpts, function (err, body, res) {
                if (err) {
                    next(err);
                    return;
                }

                if (opts.json) {
                    console.log(JSON.stringify(body));
                    next();
                    return;
                }

                console.log('Updated network %s IP %s (fields: %s)',
                    updateIpOpts.id, updateIpOpts.ip,
                    Object.keys(ctx.data).join(', '));
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
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_update.synopses = [
    '{{name}} {{cmd}} NETWORK IP [FIELD=VALUE ...]',
    '{{name}} {{cmd}} NETWORK IP -f JSON-FILE'
];

do_update.help = [
    /* BEGIN JSSTYLED */
    'Update a network ip.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where NETWORK is a network id, and IP is the ip address you want to update.',
    '',
    'Updateable fields:',
    '    ' + Object.keys(UPDATE_NETWORK_IP_FIELDS).sort().map(function (field) {
        return field + ' (' + UPDATE_NETWORK_IP_FIELDS[field] + ')';
    }).join('\n    '),

    ''
    /* END JSSTYLED */
].join('\n');

do_update.completionArgtypes = [
    'tritonnetwork',
    'tritonnetworkip',
    'tritonupdatenetworkipfield'
];

module.exports = do_update;
