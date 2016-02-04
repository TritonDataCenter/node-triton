/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton snapshot create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');


function do_create(subcmd, opts, args, cb) {
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing INST argument'));
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

    vasync.pipeline({arg: {}, funcs: [
        function createSnapshot(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.cloudapi.createMachineSnapshot(createOpts,
            function (err, snapshot) {
                if (err) {
                    next(err);
                    return;
                }

                console.log('Creating snapshot %s', snapshot.name);
                ctx.name = snapshot.name;

                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                return next();
            }

            //  1 'wait': no distraction.
            // >1 'wait': distraction, pass in the N.
            var distraction;
            if (process.stderr.isTTY && opts.wait.length > 1) {
                distraction = distractions.createDistraction(opts.wait.length);
            }

            var cloudapi = cli.tritonapi.cloudapi;
            var waiter = cloudapi.waitForSnapshotStates.bind(cloudapi);

            waiter({
                id: inst,
                name: ctx.name,
                states: ['created', 'failed']
            }, function (err, snap) {
                if (distraction) {
                    distraction.destroy();
                }

                if (err) {
                    return next(err);
                }

                if (opts.json) {
                    console.log(JSON.stringify(snap));
                } else if (snap.state === 'created') {
                    var duration = Date.now() - ctx.start;
                    console.log('Created snapshot "%s" in %s', snap.name,
                                common.humanDurationFromMs(duration));
                    next();
                } else {
                    next(new Error(format('Failed to create snapshot "%s"',
                        snap.name)));
                }
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
        helpArg: 'SNAPSHOT-NAME',
        help: 'An optional name for a snapshot.'
    },
    {
        names: ['wait', 'w'],
        type: 'arrayOfBool',
        help: 'Wait for the creation to complete. Use multiple times for a ' +
            'spinner.'
    }
];
do_create.help = [
    'Create a snapshot of a machine.',
    '',
    'Usage:',
    '     {{name}} create [<options>] INST',
    '',
    '{{options}}',
    'Snapshot do not work for instances of type "kvm".'
].join('\n');

module.exports = do_create;
