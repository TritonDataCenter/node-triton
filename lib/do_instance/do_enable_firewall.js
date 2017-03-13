/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance enable-firewall ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_enable_firewall(subcmd, opts, args, cb) {
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
            func: function enableOne(name, next) {
               console.log('Enabling firewall for instance "%s"', name);
               cli.tritonapi.enableInstanceFirewall({
                    id: name,
                    wait: opts.wait,
                    waitTimeout: opts.wait_timeout * 1000
                }, function (err, fauxInst) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Enabled firewall for instance "%s"', name);
                    next();
                });
            }
        }, function (err) {
            cb(err);
        });
    });
}


do_enable_firewall.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the firewall to be enabled.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }

];
do_enable_firewall.synopses = [
    '{{name}} enable-firewall [OPTIONS] INST [INST ...]'
];
do_enable_firewall.help = [
    'Enable the firewall of one or more instances.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');

do_enable_firewall.completionArgtypes = ['tritoninstance'];

module.exports = do_enable_firewall;
