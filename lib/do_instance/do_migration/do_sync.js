/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration sync ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');
var Watcher = require('./watcher').Watcher;


function do_sync(subcmd, opts, args, cb) {
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

    var syncOpts = {
        userId: opts.userId,
        id: inst,
        action: 'sync'
    };

    vasync.pipeline({
        arg: {
            cli: cli
        }, funcs: [
        common.cliSetupTritonApi,
        function syncMigration(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.doInstanceMigration(syncOpts,
            function syncMigrationCb(err, migration, res) {
                if (err) {
                    next(err);
                    return;
                }
                cli.log.trace({
                    instance: syncOpts.id,
                    migration: migration
                }, 'Synchronizing migration');

                ctx.instId = res.instId;
                next();
            });
        },
        function watchMigration(ctx, next) {
            if (!opts.wait) {
                next();
                return;
            }
            var _cloudapiOpts = cli.tritonapi._cloudapiOpts;

            var _watcher = new Watcher(_cloudapiOpts);

            _watcher.watchMigration({
                id: ctx.instId,
                json: opts.json,
                quiet: opts.quiet
            }, function watchMigrationCb(err, _progressEvents) {
                next(err);
            });
        }
    ]}, cb);
}

do_sync.options = [
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
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the synchronization to complete.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Quieter output. Specifically do not dump migration watch '
            + 'events as they complete.'
    }
];

do_sync.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_sync.help = [
    'The original instance will be hidden and the migrated',
    'instance will take over as the visible instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_sync.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_sync;
