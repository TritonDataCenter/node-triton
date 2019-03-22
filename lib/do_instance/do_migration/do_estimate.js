/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration estimate ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');

function do_estimate(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing <inst> argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var inst = args[0];
    var cli = this.top;

    var estimateOpts = {
        userId: opts.userId,
        id: inst
    };

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function syncMigration(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.getMigrationEstimate(estimateOpts,
            function getMigrationEstimateCb(err, estimate, res) {
                if (err) {
                    next(err);
                    return;
                }
                cli.log.trace({
                    instance: estimateOpts.id,
                    estimate: estimate
                }, 'Estimation of migration');

                ctx.instId = res.instId;
                // TODO: This is still just size as in '{ size: 13539960 }'
                // Need to complete when it provides a real ETA
                console.log(opts.json ? JSON.stringify(estimate) : estimate);

                next();
            });
        }
    ]}, cb);
}

do_estimate.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_estimate.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_estimate.help = [
    'Estimates the time required for the migration of an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_estimate.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_estimate;
