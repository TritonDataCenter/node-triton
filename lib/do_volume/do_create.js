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
        function createVolume(ctx, next) {
            var createVolumeParams = {
                type: 'tritonnfs',
                name: opts.name,
                network: opts.network,
                size: ctx.size
            };

            if (opts.type) {
                createVolumeParams.type = opts.type;
            }

            self.top.tritonapi.createVolume(createVolumeParams,
                function onRes(volCreateErr, volume) {
                    if (!volCreateErr && !opts.json) {
                        console.log('Creating volume %s (%s)', volume.name,
                            volume.id);
                    }
                    ctx.volume = volume;
                    next(volCreateErr);
                });
        },
        function maybeWait(ctx, next) {
            var distraction;
            var waitTimeout = opts.wait_timeout === undefined ?
                    undefined : opts.wait_timeout * 1000;

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
                timeout: waitTimeout
            }, function onWaitDone(waitErr, volume) {
                if (distraction) {
                    distraction.destroy();
                }

                if (waitErr) {
                    next(waitErr);
                    return;
                }

                assert.object(volume, 'volume');

                if (opts.json) {
                    console.log(JSON.stringify(volume));
                } else if (volume.state === 'ready') {
                    console.log('Created volume %s (%s)', volume.name,
                        volume.id);
                } else {
                    next(new Error(format('failed to create volume %s (%s)',
                        volume.name, volume.id)));
                    return;
                }

                next();
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
        help: 'Volume type. Default and currently only supported type is ' +
            '"tritonnfs".'
    },
    {
        names: ['size', 's'],
        type: 'string',
        helpArg: 'SIZE',
        help: 'The size of the volume to create, in the form ' +
            '`<integer><unit>`, e.g. `20G`. <integer> must be > 0. Supported ' +
            'units are `G` or `g` for gibibytes and `M` or `m` for mebibytes.' +
            ' If a size is not specified, the newly created volume will have ' +
            'a default size corresponding to the smallest size available.',
        completionType: 'tritonvolumesize'
    },
    {
        names: ['network', 'N'],
        type: 'string',
        helpArg: 'NETWORK',
        help: 'A network (ID, name or short id) to which the newly created ' +
            'volume will be attached. By default, the newly created volume ' +
            'will be attached to the account\'s default fabric network.',
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
        help: 'The number of seconds to wait before timing out with an error.'
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
    'Note: Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'
    /* END JSSTYLED */
].join('\n');

do_create.completionArgtypes = ['tritonvolume', 'none'];

module.exports = do_create;
