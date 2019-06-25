/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration switch ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');
var Watcher = require('./watcher').Watcher;

function do_switch(subcmd, opts, args, cb) {
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

    var switchOpts = {
        userId: opts.userId,
        id: inst,
        action: 'switch'
    };

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function switchMigration(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.doInstanceMigration(switchOpts,
            function switchMigrationCb(err, migration, res) {
                if (err) {
                    next(err);
                    return;
                }
                cli.log.trace({
                    instance: switchOpts.id,
                    migration: migration
                }, 'Switching to migration');
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

do_switch.options = [
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
        help: 'Wait for the switch to complete.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Quieter output. Specifically do not dump migration watch '
            + 'events as they complete.'
    }
];

do_switch.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_switch.help = [
    'Switch an instance to a migration.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_switch.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_switch;
