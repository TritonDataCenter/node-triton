/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton volume delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');


function deleteVolume(volumeName, opts, cb) {
    assert.string(volumeName, 'volumeName');
    assert.object(opts, 'opts');
    assert.object(opts.tritonapi, 'opts.tritonapi');
    assert.func(cb, 'cb');

    var tritonapi = opts.tritonapi;

    vasync.pipeline({funcs: [
        function getVolume(ctx, next) {
            tritonapi.getVolume(volumeName,
                function onGetVolume(getVolErr, volume) {
                    if (!getVolErr) {
                        ctx.volume = volume;
                    }

                    next(getVolErr);
                });
        },
        function doDeleteVolume(ctx, next) {
            assert.object(ctx.volume, 'ctx.volume');

            tritonapi.cloudapi.deleteVolume(ctx.volume.id,
                next);
        },
        function waitForVolumeStates(ctx, next) {
            assert.object(ctx.volume, 'ctx.volume');

            var distraction;
            var volumeId = ctx.volume.id;

            if (!opts.wait) {
                next();
                return;
            }

            distraction = distractions.createDistraction(opts.wait.length);

            tritonapi.cloudapi.waitForVolumeStates({
                id: volumeId,
                states: ['deleted', 'failed']
            }, function onWaitDone(waitErr, volume) {
                distraction.destroy();
                next(waitErr);
            });
        }
    ], arg: {}}, cb);
}

function do_delete(subcmd, opts, args, cb) {
    var self = this;

    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('missing VOLUME arg(s)'));
        return;
    }

    var context = {
        volumeIds: args,
        cli: this.top
    };

    vasync.pipeline({arg: context, funcs: [
        common.cliSetupTritonApi,
        function confirm(ctx, next) {
            var promptMsg;

            if (opts.yes) {
                next();
                return;
            }

            if (ctx.volumeIds.length === 1) {
                promptMsg = format('Delete volume %s? [y/n] ',
                    ctx.volumeIds[0]);
            } else {
                promptMsg = format('Delete %d volumes? [y/n] ',
                    ctx.volumeIds.length);
            }

            common.promptYesNo({msg: promptMsg},
                function onPromptAnswered(answer) {
                    if (answer !== 'y') {
                        console.error('Aborting');
                        /*
                         * Early abort signal.
                         */
                        next(true);
                    } else {
                        next();
                    }
                });
        },
        function deleteVolumes(ctx, next) {
            vasync.forEachParallel({
                func: function doDeleteVolume(volumeId, done) {
                    self.top.tritonapi.deleteVolume({
                        id: volumeId,
                        wait: opts.wait && opts.wait.length > 0,
                        waitTimeout: opts.wait_timeout * 1000,
                        tritonapi: self.top.tritonapi
                    }, function onVolDeleted(volDelErr) {
                        if (volDelErr) {
                            console.error('Error when deleting volume %s, '
                                + 'reason: %s', volumeId, volDelErr);
                        } else {
                            console.log('Deleted volume %s', volumeId);
                        }

                        done();
                    });
                },
                inputs: ctx.volumeIds
            }, next);
        }
    ]}, function onDone(err) {
        if (err === true) {
            /*
             * Answered 'no' to confirmation to delete.
             */
            err = null;
        }

        if (err) {
            cb(err);
            return;
        }

        cb();
    });
}

do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: 'Other options'
    },
    {
        names: ['wait', 'w'],
        type: 'arrayOfBool',
        help: 'Wait for the deletion to complete. Use multiple times for a ' +
            'spinner.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer yes to confirmation to delete.'
    }
];

do_delete.synopses = ['{{name}} {{cmd}} [OPTIONS] VOLUME [VOLUME ...]'];

do_delete.help = [
    'Deletes a volume.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Where VOLUME is a volume id (full UUID), exact name, or short id.'
].join('\n');

do_delete.completionArgtypes = ['tritonvolume', 'none'];
do_delete.aliases = ['rm'];

module.exports = do_delete;
