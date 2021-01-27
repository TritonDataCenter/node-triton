/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton vpc get ...`
 */

var assert = require('assert-plus');

var common = require('../common');
var errors = require('../errors');


function do_get(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing VPC argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];
    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.getVPC(id, function onGet(err, vpc) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(vpc));
            } else {
                console.log(JSON.stringify(vpc, null, 4));
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

do_get.synopses = ['{{name}} {{cmd}} VPC'];

do_get.help = [
    'Show a specific VPC.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where VPC is a VPC id or name.'
].join('\n');

do_get.completionArgtypes = ['tritonvpc', 'none'];

module.exports = do_get;
