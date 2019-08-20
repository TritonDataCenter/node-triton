/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration finalize ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


function do_finalize(subcmd, opts, args, cb) {
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

    var finalizeOpts = {
        userId: opts.userId,
        id: inst,
        action: 'finalize'
    };

    vasync.pipeline({
        arg: {
            cli: cli
        }, funcs: [
        common.cliSetupTritonApi,
        function finalizeMigration(ctx, next) {
            cli.tritonapi.doInstanceMigration(finalizeOpts,
            function finalizeMigrationCb(err) {
                if (err) {
                    next(err);
                    return;
                }

                console.log('Done - the migration is finalized');
                next();
            });
        }
    ]}, cb);
}

do_finalize.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_finalize.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_finalize.help = [
    'The original source instance will be removed (cleaned up).',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_finalize.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_finalize;
