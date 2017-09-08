/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance nic get ...`
 */

var assert = require('assert-plus');

var common = require('../../common');
var errors = require('../../errors');


function do_get(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and MAC arguments'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var inst = args[0];
    var mac  = args[1];
    var cli  = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.getNic({id: inst, mac: mac}, function onNic(err, nic) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(nic));
            } else {
                console.log(JSON.stringify(nic, null, 4));
            }

            cb();
        });
    });
}


do_get.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_get.synopses = ['{{name}} {{cmd}} INST MAC'];

do_get.help = [
    'Show a specific NIC.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id (full UUID), name, or short id.'
].join('\n');

do_get.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_get;
