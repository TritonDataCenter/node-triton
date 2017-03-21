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
        volumeIds: args
    };

    vasync.pipeline({arg: context, funcs: [
        function setup(ctx, next) {
            common.cliSetupTritonApi({
                cli: self.top
            }, function onSetup(setupErr) {
                next(setupErr);
            });
        },
        function deleteVolumes(ctx, next) {
            vasync.forEachParallel({
                func: function doDeleteVolume(volumeId, done) {
                    deleteVolume(volumeId, {
                        wait: opts.wait,
                        tritonapi: self.top.tritonapi
                    }, done);
                },
                inputs: ctx.volumeIds
            }, next);
        }
    ]}, function onDone(err) {
        if (err) {
            cb(err);
            return;
        }

        console.log('%s volume %s', common.capitalize('delete'), args);

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
