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

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        vasync.forEachParallel({
            inputs: args,
            func: function disableOne(name, next) {
               console.log('Disabling firewall for instance "%s"', name);
               cli.tritonapi.disableInstanceFirewall({
                    id: name,
                    wait: opts.wait,
                    waitTimeout: opts.wait_timeout * 1000
                }, function (err, fauxInst) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Disabled firewall for instance "%s"', name);
                    next();
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
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
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
