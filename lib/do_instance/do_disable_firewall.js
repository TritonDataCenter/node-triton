/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance disable-firewall ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_disable_firewall(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('Missing <inst> argument(s)'));
        return;
    }

    var cli = this.top;
    var insts = args;

    function wait(instId, startTime, next) {
        var cloudapi = cli.tritonapi.cloudapi;
        var waiter = cloudapi.waitForMachineFirewallState.bind(cloudapi);

        waiter({
            id: instId,
            state: false
        }, function (err, inst) {
            if (err) {
                return next(err);
            }

            if (inst.firewall_enabled === false) {
                var duration = Date.now() - startTime;
                var durStr = common.humanDurationFromMs(duration);
                console.log('Disabled firewall for instance "%s" in %s', instId,
                            durStr);
                next();
            } else {
                // shouldn't get here, but...
                var msg = 'Failed to disable firewall for instance "%s"';
                next(new Error(format(msg, instId)));
            }
        });
    }

    vasync.pipeline({funcs: [
        function confirm(_, next) {
            if (opts.force) {
                return next();
            }

            var msg;
            if (insts.length === 1) {
                msg = 'Disable firewall for instance "' + insts[0] +
                      '"? [y/n] ';
            } else {
                msg = format('Disable firewalls for %d instances (%s)? [y/n] ',
                    insts.length, insts.join(', '));
            }

            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },
        function disableThem(_, next) {
            var startTime = Date.now();

            vasync.forEachParallel({
                inputs: insts,
                func: function disableOne(instId, nextId) {
                    cli.tritonapi.disableInstanceFirewall({
                        id: instId
                    }, function (err, __, res) {
                        if (err) {
                            nextId(err);
                            return;
                        }

                        var msg = 'Disabling firewall for instance "%s"';
                        console.log(msg, res.instId);

                        if (opts.wait) {
                            wait(res.instId, startTime, nextId);
                        } else {
                            nextId();
                        }
                    });
                }
            }, next);
        }
    ]}, function (err) {
        if (err === true) {
            err = null;
        }
        cb(err);
    });
}


do_disable_firewall.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Skip confirmation to enable.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the firewall to be disabled.'
    }
];
do_disable_firewall.help = [
    'Disable the firewall of one or more instances.',
    '',
    'Usage:',
    '    {{name}} disable-firewall [<options>] <inst> [<inst>...]',
    '',
    '{{options}}'
].join('\n');

module.exports = do_disable_firewall;
