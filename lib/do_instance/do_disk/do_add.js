/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disk add ...`
 */
var assert = require('assert-plus');
var jsprim = require('jsprim');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');

function do_add(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and/or SIZE arguments'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;
    var instanceId = args[0];
    var size = args[1];

    if (size !== 'remaining') {
        size = jsprim.parseInteger(size);

        if (typeof (size) !== 'number') {
            cb(new errors.UsageError('SIZE must be a number or "remaining"'));
            return;
        }
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function getDisks(ctx, next) {
            ctx.start = Date.now();

            cli.tritonapi.listInstanceDisks({
                id: instanceId
            }, function onDisks(err, disks) {
                if (err) {
                    next(err);
                    return;
                }

                ctx.disks = disks;
                next();
            });
        },
        function addDisk(ctx, next) {
            cli.tritonapi.addInstanceDisk({
                id: instanceId,
                size: size
            }, function onAddDisk(err, _body, res) {
                if (err) {
                    cb(err);
                    return;
                }

                ctx.instId = res.instId;

                console.log('Adding disk to instance %s',
                    instanceId);
                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                next();
                return;
            }

            var cloudapi = cli.tritonapi.cloudapi;
            var waiter = cloudapi.waitForDiskCreate.bind(cloudapi);

            waiter({
                id: ctx.instId,
                disks: ctx.disks,
                size: size,
                waitTimeout: opts.wait_timeout * 1000
            }, function (err, disk) {
                if (err) {
                    next(err);
                    return;
                }

                if (disk) {
                    var duration = Date.now() - ctx.start;
                    console.log('Added disk "%s" in %s', disk.id,
                                common.humanDurationFromMs(duration));
                    next();
                } else {
                    next(new Error('Failed to create disk'));
                }
            });
        }
    ]}, cb);
}

do_add.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
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

do_add.synopses = ['{{name}} {{cmd}} [OPTIONS] INST SIZE'];

do_add.help = [
    'Add a disk to a flexible disk instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Arguments:',
    '    INST        Instance name, id, or short id',
    '    SIZE        Size in mebibytes or "remaining"'
].join('\n');

do_add.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_add;
