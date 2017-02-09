/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance reboot ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_reboot(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('missing INST arg(s)'));
        return;
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }

        var rebootErrs = [];

        vasync.forEachParallel({
            inputs: args,
            func: function rebootOne(arg, nextInst) {
                console.log('Rebooting instance %s', arg);
                tritonapi.rebootInstance({
                    id: arg,
                    wait: opts.wait,
                    waitTimeout: opts.wait_timeout * 1000
                }, function (rebootErr) {
                    if (rebootErr) {
                        rebootErrs.push(rebootErr);
                        console.log('Error rebooting instance %s: %s', arg,
                            rebootErr.message);
                    } else if (opts.wait) {
                        console.log('Rebooted instance %s', arg);
                    }
                    nextInst();
                });

            }
        }, function doneReboots(err) {
            assert.ok(!err, '"err" should be impossible as written');
            if (rebootErrs.length === 1) {
                cb(rebootErrs[0]);
            } else if (rebootErrs.length > 1) {
                cb(new errors.MultiError(rebootErrs));
            } else {
                cb();
            }
        });
    });
}


do_reboot.synopses = ['{{name}} reboot [OPTIONS] INST [INST ...]'];
do_reboot.help = [
    'Reboot one or more instances.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');
do_reboot.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait until the instance(s) have rebooted.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }
];

do_reboot.completionArgtypes = ['tritoninstance'];



module.exports = do_reboot;
