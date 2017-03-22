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
var mod_volumes = require('../volumes');

function do_create(subcmd, opts, args, cb) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length !== 0) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        function validateVolumeSize(ctx, next) {
            if (opts.size === undefined) {
                next();
                return;
            }

            try {
                ctx.size = mod_volumes.parseVolumeSize(opts.size);
            } catch (parseSizeErr) {
                next(parseSizeErr);
                return;
            }

            next();
        },
        common.cliSetupTritonApi,
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
                size: ctx.size
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
            var distraction;

            if (!opts.wait) {
                next();
                return;
            }

            if (process.stderr.isTTY && opts.wait.length > 1) {
                distraction = distractions.createDistraction(opts.wait.length);
            }

            self.top.tritonapi.cloudapi.waitForVolumeStates({
                id: ctx.volume.id,
                states: ['ready', 'failed'],
                timeout: opts.wait_timeout * 1000
            }, function onWaitDone(waitErr, volume) {
                if (distraction) {
                    distraction.destroy();
                }

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
    ]}, cb);
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
        names: ['size', 's'],
        type: 'string',
        helpArg: 'SIZE',
        help: 'The `size` input parameter must match the following regular ' +
            'expression: /(\d+)(g|m|G|M|gb|mb|GB|MB)/ All units are in ' +
            'ibibytes (mebibytes and gibibytes). `g`, `G`, `gb` and `GB` ' +
            'stand for "gibibytes". `m`, `M`, `mb` and `MB` stand for ' +
            '"mebibytes".',
        completionType: 'tritonvolumesize'
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
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_create.help = [
    /* BEGIN JSSTYLED */
    'Create a volume.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Note: Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'
    /* END JSSTYLED */
].join('\n');

do_create.completionArgtypes = ['tritonvolume', 'none'];

module.exports = do_create;
