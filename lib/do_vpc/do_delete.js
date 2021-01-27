/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton vpc delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_delete(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 1) {
        cb(new errors.UsageError('missing VPC argument(s)'));
        return;
    }

    var cli = this.top;
    var vpcIds = args;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        vasync.forEachParallel({
            inputs: vpcIds,
            func: function deleteOne(id, next) {
                cli.tritonapi.deleteVPC({ vpc_id: id },
                        function onDelete(err) {
                    if (err) {
                        next(err);
                        return;
                    }

                    console.log('Deleted VPC %s', id);
                    next();
                });
            }
        }, cb);
    });
}


do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_delete.synopses = ['{{name}} {{cmd}} VPC [VPC ...]'];

do_delete.help = [
    'Remove a VPC.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where VPC is a VPC id or name.'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritonvpc'];

module.exports = do_delete;
