/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration automatic ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');
var Watcher = require('./watcher').Watcher;

function do_automatic(subcmd, opts, args, cb) {
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

    var automaticOpts = {
        userId: opts.userId,
        id: inst,
        action: 'automatic'
    };

    if (opts.affinity) {
        automaticOpts.affinity = opts.affinity;
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function automaticMigration(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.doInstanceMigration(automaticOpts,
            function createMigrationCb(err, migration, res) {
                if (err) {
                    next(err);
                    return;
                }
                cli.log.trace({
                    instance: automaticOpts.id,
                    migration: migration
                }, 'Initiated migration');
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

do_automatic.options = [
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
        names: ['affinity', 'a'],
        type: 'arrayOfString',
        helpArg: 'RULE',
        help: 'Affinity rules for selecting a server for this instance ' +
            'migration. Rules have one of the following forms: ' +
            '`instance==INST` (the new instance must be on the same server ' +
            'as INST), `instance!=INST` (new inst must *not* be on the same ' +
            'server as INST), `instance==~INST` (*attempt* to place on the ' +
            'same server as INST), or `instance!=~INST` (*attempt* to place ' +
            'on a server other than INST\'s). `INST` is an existing ' +
            'instance name or id. Use this option more than once for ' +
            'multiple rules.',
        completionType: 'tritonaffinityrule'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the creation to complete.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Quieter output. Specifically do not dump migration watch '
            + 'events as they complete.'
    }
];

do_automatic.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_automatic.help = [
    'Migrates the given instance.',
    'Equivalent to begin + sync + switch.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_automatic.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_automatic;
