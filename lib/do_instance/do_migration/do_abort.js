/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration abort ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');

function do_abort(subcmd, opts, args, cb) {
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

    var abortOpts = {
        userId: opts.userId,
        id: inst,
        action: 'abort'
    };

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function abortMigration(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.doInstanceMigration(abortOpts,
            function abortMigrationCb(err, _migration, res) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.instId = res.instId;

                next();
            });
        }
    ]}, cb);
}

do_abort.options = [
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

do_abort.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_abort.help = [
    'aborts in-progress instance synchronization for an existing migration.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_abort.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_abort;
