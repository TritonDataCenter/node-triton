/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton volume create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');


function do_create(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var context = {};

    vasync.pipeline({funcs: [
        function setup(ctx, next) {
            common.cliSetupTritonApi({
                cli: self.top
            }, function onSetup(setupErr) {
                next(setupErr);
            });
        },
        function getNetworks(ctx, next) {
            if (!opts.network) {
                return next();
            }

            ctx.networks = [];

            vasync.forEachParallel({
                inputs: opts.network,
                func: function getNetwork(networkName, nextNet) {
                    self.top.tritonapi.getNetwork(networkName,
                        function onGetNetwork(getNetErr, net) {
                            if (net) {
                                ctx.networks.push(net);
                            }

                            nextNet(getNetErr);
                        });
                }
            }, next);
        },
        function createVolume(ctx, next) {
            var createVolumeParams = {
                type: 'tritonnfs',
                name: opts.name,
                networks: ctx.networks,
                size: opts.size
            };

            if (opts.type) {
                createVolumeParams.type = opts.type;
            }

            self.top.tritonapi.cloudapi.createVolume(createVolumeParams,
                function onRes(volCreateErr, volume) {
                    ctx.volume = volume;
                    next(volCreateErr);
                });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                next();
                return;
            }

            var distraction = distractions.createDistraction(opts.wait.length);

            self.top.tritonapi.cloudapi.waitForVolumeStates({
                id: ctx.volume.id,
                states: ['ready', 'failed']
            }, function onWaitDone(waitErr, volume) {
                distraction.destroy();
                ctx.volume = volume;
                next(waitErr);
            });
        },
        function outputRes(ctx, next) {
            assert.object(ctx.volume, 'ctx.volume');

            if (opts.json) {
                console.log(JSON.stringify(ctx.volume));
            } else {
                console.log(JSON.stringify(ctx.volume, null, 4));
            }
        }
    ], arg: context}, callback);
}

do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: 'Create options'
    },
    {
        names: ['name', 'n'],
        helpArg: 'NAME',
        type: 'string',
        help: 'Volume name. If not given, one will be generated server-side.'
    },
    {
        names: ['type', 't'],
        helpArg: 'TYPE',
        type: 'string',
        help: 'Volume type. Default is "tritonnfs".'
    },
    {
        names: ['size', 'S'],
        type: 'string',
        helpArg: 'SIZE',
        help: '',
        completionType: 'volumesize'
    },
    {
        names: ['network', 'N'],
        type: 'arrayOfCommaSepString',
        helpArg: 'NETWORK',
        help: 'One or more comma-separated networks (ID, name or short id). ' +
            'This option can be used multiple times.',
        completionType: 'tritonnetwork'
    },
    {
        group: 'Other options'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {
        names: ['wait', 'w'],
        type: 'arrayOfBool',
        help: 'Wait for the creation to complete. Use multiple times for a ' +
            'spinner.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] VOLUME'];

do_create.help = [
    /* BEGIN JSSTYLED */
    'Create a volume.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Where VOLUME is a package id (full UUID), exact name, or short id.',
    '',
    'Note: Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'
    /* END JSSTYLED */
].join('\n');

do_create.completionArgtypes = ['tritonvolume', 'none'];

module.exports = do_create;
