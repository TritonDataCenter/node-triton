/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton volume create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');
var mat = require('../metadataandtags');
var mod_volumes = require('../volumes');

function do_create(subcmd, opts, args, cb) {
    var self = this;
    var log = this.top.log;

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
        function loadTags(ctx, next) {
            mat.tagsFromCreateOpts(opts, log, function (err, tags) {
                if (err) {
                    next(err);
                    return;
                }
                if (tags) {
                    log.trace({tags: tags}, 'tags loaded from opts');
                    ctx.tags = tags;
                }
                next();
            });
        },
        function createVolume(ctx, next) {
            var createVolumeParams = {
                type: 'tritonnfs',
                affinity: opts.affinity,
                name: opts.name,
                network: opts.network,
                size: ctx.size,
                tags: ctx.tags
            };

            if (opts.type) {
                createVolumeParams.type = opts.type;
            }

            self.top.tritonapi.createVolume(createVolumeParams,
                function onRes(volCreateErr, volume) {
                    /*
                     * VolumeSizeNotAvailable errors include additional
                     * information in their message
                     * about available volume sizes using units that are
                     * different than the units node-triton users have to use
                     * when specifying volume sizes on the command line
                     * (mebibytes vs gibibytes).
                     * As a result, we override this type of error to provide a
                     * simpler message that is less confusing, and users can use
                     * the "triton volume sizes" command to find out which
                     * sizes are available.
                     */
                    if (volCreateErr &&
                        volCreateErr.name === 'VolumeSizeNotAvailableError') {
                        next(new Error('volume size not available, use ' +
                            'triton volume sizes command for available sizes'));
                        return;
                    }

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
        help: 'The size of the volume to create, in gibibytes, in the form ' +
            '`<integer>G`, e.g. `20G`. <integer> must be > 0. If a size is ' +
            'not specified, the newly created volume will have a default ' +
            'size corresponding to the smallest size available. Available ' +
            'volume sizes can be listed via the "volume sizes" sub-command.',
        completionType: 'tritonvolumesize'
    },
    {
        names: ['tag'],
        type: 'arrayOfString',
        helpArg: 'TAG',
        help: 'Add a tag when creating the instance. Tags are ' +
            'key/value pairs available on the volume object as the ' +
            '"tags" field. TAG is one of: a "key=value" string (bool and ' +
            'numeric "value" are converted to that type), a JSON object ' +
            '(if first char is "{"), or a "@FILE" to have tags be ' +
            'loaded from FILE. This option can be used multiple times.'
    },
    {
        names: ['affinity', 'a'],
        type: 'arrayOfString',
        helpArg: 'RULE',
        help: 'Affinity rules for selecting a server for this volume. ' +
            'Rules have one of the following forms: `tag==value` (the ' +
            'new volume must reside on the same server as an instance with a ' +
            'matching tag/value), `tag!=value` (new volume must *not* reside ' +
            'on the same server as an instance using this tag/value). Use ' +
            'this option more than once for multiple rules.',
        completionType: 'tritonaffinityrule'
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
