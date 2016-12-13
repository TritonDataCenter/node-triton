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
        cb(new errors.UsageError('missing INST argument(s)'));
        return;
    }

    var cli = this.top;

    function wait(name, id, next) {
        cli.tritonapi.cloudapi.waitForMachineFirewallEnabled({
            id: id,
            state: false
        }, function (err, inst) {
            if (err) {
                next(err);
                return;
            }
            assert.ok(!inst.firewall_enabled, format(
                'inst %s firewall_enabled not in expected state after '
                + 'waitForMachineFirewallEnabled', id));

            console.log('Disabled firewall for instance "%s"', name);
            next();
        });
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        vasync.forEachParallel({
            inputs: args,
            func: function disableOne(name, nextInst) {
                cli.tritonapi.disableInstanceFirewall({
                    id: name
                }, function (err, fauxInst) {
                    if (err) {
                        nextInst(err);
                        return;
                    }

                    console.log('Disabling firewall for instance "%s"', name);

                    if (opts.wait) {
                        wait(name, fauxInst.id, nextInst);
                    } else {
                        nextInst();
                    }
                });
            }
        }, function (err) {
            cb(err);
        });
    });
}


do_disable_firewall.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the firewall to be disabled.'
    }
];
do_disable_firewall.synopses = [
    '{{name}} disable-firewall [OPTIONS] INST [INST ...]'
];
do_disable_firewall.help = [
    'Disable the firewall of one or more instances.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');

do_disable_firewall.completionArgtypes = ['tritoninstance'];

module.exports = do_disable_firewall;
