/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration get ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');

var stylize = common.ansiStylizeTty;

function do_get(subcmd, opts, args, cb) {
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

    var getOpts = {
        userId: opts.userId,
        id: inst,
        action: 'get'
    };

    vasync.pipeline({
        arg: {
            cli: cli
        }, funcs: [
        common.cliSetupTritonApi,
        function getMigration(ctx, next) {
            ctx.start = Date.now();
            cli.tritonapi.getMigration(getOpts,
                function getMigrationCb(err, migration, res) {
                if (err) {
                    next(err);
                    return;
                }
                cli.log.trace({
                    instance: getOpts.id,
                    migration: migration
                }, 'Geting migration');

                ctx.instId = res.instId;

                if (opts.json) {
                    console.log(JSON.stringify(migration));
                    next();
                    return;
                } else {
                    var state = migration.state;
                    if (state === 'successful') {
                        console.log(
                            'State:         ' + stylize(state, 'green'));
                    } else if (state === 'running') {
                        console.log(
                            'State:         ' + stylize(state, 'bold'));
                    } else if (state === 'failed') {
                        console.log(
                            'State:         ' + stylize(state, 'red'));
                    } else {
                        console.log('State:         ' + state);
                    }

                    console.log('Created:       ' +
                        migration.created_timestamp);
                    console.log('Automatic:     ' + migration.automatic);
                    if (migration.duration_ms) {
                        console.log('Total runtime: ' +
                            common.humanDurationFromMs(migration.duration_ms));
                    }
                    console.log('Phases: ');

                    var phases = migration.progress_history;
                    var columns = 'phase,state,age,runtime,message';
                    var rows = [];
                    var i;
                    for (i = 0; i < phases.length; i += 1) {
                        var phase = phases[i];
                        rows.push({
                            phase: phase.phase,
                            state: phase.state,
                            age: common.longAgo(new Date(
                                phase.started_timestamp)),
                            runtime: common.humanDurationFromMs(
                                phase.duration_ms),
                            message: phase.message
                        });
                    }

                    tabula(rows, {
                        columns: columns.split(',')
                    });

                    if (state === 'successful') {
                        console.log(stylize(
                            'Migration finished successfully', 'green'));
                    } else if (state === 'failed' || migration.error) {
                        console.log(stylize(
                            'Migration error: ' + migration.error, 'red'));
                    } else {
                        console.log('Migration ' + state);
                    }
                    next();
                }
            });
        }
    ]}, cb);
}

do_get.options = [
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

do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_get.help = [
    'Get instance migration details.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_get.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_get;
