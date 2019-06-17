/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disk resize ...`
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');

function do_resize(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 3) {
        cb(new errors.UsageError('missing INST, DISK and/or SIZE arguments'));
        return;
    } else if (args.length > 3) {
        cb(new errors.UsageError('too many arguments'));
        return;
    }

    var cli = this.top;
    var instanceId = args[0];
    var diskId = args[1];
    var size = args[2];

    size = jsprim.parseInteger(size);

    if (typeof (size) !== 'number') {
        cb(new errors.UsageError('SIZE must be a number'));
        return;
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function getDisk(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.getInstanceDisk({
                id: instanceId,
                diskId: diskId
            }, function onDisk(err, disk) {
                if (err) {
                    next(err);
                    return;
                }

                ctx.disk = disk;
                next();
            });
        },
        function resizeDisk(ctx, next) {
            if (size < ctx.disk.size && !opts.dangerous_allow_shrink) {
                next(new Error('--dangerous-allow-shrink must be specified ' +
                                'when shrinking a disk'));
                return;
            }

            cli.tritonapi.resizeInstanceDisk({
                id: instanceId,
                diskId: diskId,
                size: size,
                dangerousAllowShrink: opts.dangerous_allow_shrink
            }, function onResized(err, _, res) {
                if (err) {
                    next(err);
                    return;
                }

                ctx.instId = res.instId;

                console.log('Resizing disk "%s"', ctx.disk.id);
                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                next();
                return;
            }

            var cloudapi = cli.tritonapi.cloudapi;
            var waiter = cloudapi.waitForDiskResize.bind(cloudapi);

            waiter({
                id: ctx.instId,
                diskId: ctx.disk.id,
                size: size,
                waitTimeout: opts.wait_timeout * 1000
            }, function onDone(err, disk) {
                if (err) {
                    next(err);
                    return;
                }

                if (disk) {
                    var duration = Date.now() - ctx.start;
                    console.log('Resized disk "%s" in %s', disk.id,
                                common.humanDurationFromMs(duration));
                    next();
                    return;
                }

                next(new Error('Failed to resize disk'));
            });
        }
    ]}, cb);
}

do_resize.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['dangerous-allow-shrink'],
        type: 'bool',
        help: 'Allows the disk size to be reduced. This will truncate the ' +
              'disk. Any data previously written to the truncated area is ' +
              'permanently lost. Snapshots will not be useful to recover ' +
              'from this operation.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Block until instance state indicates the action is complete.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }
];

do_resize.synopses = ['{{name}} {{cmd}} [OPTIONS] INST DISK SIZE'];

do_resize.help = [
    'Resize a disk for a bhyve instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_resize.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_resize;
