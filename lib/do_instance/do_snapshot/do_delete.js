/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton snapshot delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


function do_delete(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and SNAPNAME argument(s)'));
        return;
    }

    var cli = this.top;
    var inst = args[0];
    var names = args.slice(1, args.length);

    function wait(instId, name, startTime, next) {
        var cloudapi = cli.tritonapi.cloudapi;
        var waiter = cloudapi.waitForSnapshotStates.bind(cloudapi);

        waiter({
            id: instId,
            name: name,
            states: ['deleted']
        }, function (err, snap) {
            if (err) {
                return next(err);
            }

            if (snap.state === 'deleted') {
                var duration = Date.now() - startTime;
                var durStr = common.humanDurationFromMs(duration);
                console.log('Deleted snapshot "%s" in %s', name, durStr);

                next();
            } else {
                // shouldn't get here, but...
                next(new Error(format('Failed to delete snapshot "%s"', name)));
            }
        });
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function confirm(_, next) {
            if (opts.force) {
                return next();
            }

            var msg;
            if (names.length === 1) {
                msg = 'Delete snapshot "' + names[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d snapshots (%s)? [y/n] ',
                    names.length, names.join(', '));
            }

            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },
        function deleteThem(_, next) {
            var startTime = Date.now();

            vasync.forEachParallel({
                inputs: names,
                func: function deleteOne(name, nextName) {
                    cli.tritonapi.deleteInstanceSnapshot({
                        id: inst,
                        name: name
                    }, function (err, res) {
                        if (err) {
                            nextName(err);
                            return;
                        }

                        var instId = res.instId;

                        var msg = 'Deleting snapshot "%s" of instance "%s"';
                        console.log(msg, name, instId);

                        if (opts.wait) {
                            wait(instId, name, startTime, nextName);
                        } else {
                            nextName();
                        }
                    });
                }
            }, next);
        }
    ]}, function (err) {
        if (err === true) {
            err = null;
        }
        cb(err);
    });
}


do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Skip confirmation of delete.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the deletion to complete.'
    }
];

do_delete.synopses = ['{{name}} {{cmd}} [OPTIONS] INST SNAPNAME [SNAPNAME...]'];

do_delete.help = [
    'Remove a snapshot from an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_delete.aliases = ['rm'];

// TODO: When have 'tritonsnapshot' completion, then use this:
//  do_get.completionArgtypes = ['tritoninstance', 'tritonsnapshot'];
do_delete.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_delete;
