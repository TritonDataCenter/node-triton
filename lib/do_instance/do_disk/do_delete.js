/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disk delete ...`
 */
var assert = require('assert-plus');
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
        cb(new errors.UsageError('missing INST and/or DISKID arguments'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;
    var instanceId = args[0];
    var diskId = args[1];

    vasync.pipeline({arg: {
        cli: this.top,
        start: Date.now()
    }, funcs: [
        common.cliSetupTritonApi,
        function deleteDisk(ctx, next) {
            cli.tritonapi.deleteInstanceDisk({
                id: instanceId,
                diskId: diskId
            }, function onDeleted(err, res) {
                if (err) {
                    cb(err);
                    return;
                }

                ctx.instId = res.instId;
                ctx.deleteId = res.diskId;

                console.log('Deleting disk "%s" from instance %s',
                    diskId, instanceId);
                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                next();
                return;
            }

            var cloudapi = cli.tritonapi.cloudapi;
            var waiter = cloudapi.waitForDiskDelete.bind(cloudapi);

            waiter({
                id: ctx.instId,
                diskId: ctx.deleteId,
                waitTimeout: opts.wait_timeout * 1000
            }, function (err) {
                if (err) {
                    next(err);
                    return;
                }

                var duration = Date.now() - ctx.start;
                console.log('Deleted disk "%s" in %s', diskId,
                            common.humanDurationFromMs(duration));
                next();
            });
        }
    ]}, cb);
}


do_delete.options = [
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

do_delete.synopses = ['{{name}} {{cmd}} [OPTIONS] INST DISK'];

do_delete.help = [
    'Delete a disk from an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_delete;
