/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton snapshot create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


function do_create(subcmd, opts, args, cb) {
    assert.optionalString(opts.name, 'opts.name');
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

    var createOpts = {
        userId: opts.userId,
        id: inst
    };

    if (opts.name) {
        createOpts.name = opts.name;
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function createSnapshot(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.createInstanceSnapshot(createOpts,
            function (err, snapshot, res) {
                if (err) {
                    next(err);
                    return;
                }

                console.log('Creating snapshot %s of instance %s',
                    snapshot.name, createOpts.id);
                ctx.name = snapshot.name;
                ctx.instId = res.instId;

                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                next();
                return;
            }

            var cloudapi = cli.tritonapi.cloudapi;
            var waiter = cloudapi.waitForSnapshotStates.bind(cloudapi);

            waiter({
                id: ctx.instId,
                name: ctx.name,
                states: ['created', 'failed'],
                waitTimeout: opts.wait_timeout * 1000
            }, function (err, snap) {
                if (err) {
                    next(err);
                    return;
                }

                if (opts.json) {
                    console.log(JSON.stringify(snap));
                    next();
                    return;
                }

                if (snap.state === 'created') {
                    var duration = Date.now() - ctx.start;
                    console.log('Created snapshot "%s" in %s', snap.name,
                                common.humanDurationFromMs(duration));
                    next();
                    return;
                }

                next(new Error(format('Failed to create snapshot "%s"',
                        snap.name)));
            });
        }
    ]}, cb);
}


do_create.options = [
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
        names: ['name', 'n'],
        type: 'string',
        helpArg: 'SNAPNAME',
        help: 'An optional name for a snapshot.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the creation to complete.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an '
            + 'error. The default is 120 seconds.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_create.help = [
    'Create a snapshot of an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Snapshots do not work for instances of type "bhyve" or "kvm".'
].join('\n');

do_create.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_create;
