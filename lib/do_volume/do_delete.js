/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton volume del ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');

function perror(err) {
    console.error('error: %s', err.message);
}
function deleteVolume(volumeName, options, callback) {
    assert.string(volumeName, 'volumeName');
    assert.object(options, 'options');
    assert.object(options.tritonapi, 'options.tritonapi');
    assert.func(callback, 'callback');

    var tritonapi = options.tritonapi;

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

            if (!options.wait) {
                next();
                return;
            }

            distraction = distractions.createDistraction(options.wait.length);

            tritonapi.cloudapi.waitForVolumeStates({
                id: volumeId,
                states: ['deleted', 'failed']
            }, function onWaitDone(waitErr, volume) {
                distraction.destroy();
                next(waitErr);
            });
        }
    ], arg: {}}, callback);
}

function do_delete(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        self.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1) {
        callback(new errors.UsageError('missing VOLUME arg(s)'));
        return;
    }

    var context = {
        volumeIds: args
    };

    vasync.pipeline({funcs: [
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
    ], arg: context}, function onDone(err) {
        if (err) {
            perror(err);
            callback(err);
            return;
        }

        console.log('%s volume %s', common.capitalize('delete'), args);

        callback();
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
