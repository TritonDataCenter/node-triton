/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network delete ...`
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
        cb(new errors.UsageError('missing NETWORK argument(s)'));
        return;
    }

    var cli = this.top;
    var networks = args;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        vasync.forEachParallel({
            inputs: networks,
            func: function deleteOne(id, next) {
                cli.tritonapi.deleteFabricNetwork({ id: id },
                         function onDelete(err) {
                    if (err) {
                        next(err);
                        return;
                    }

                    console.log('Deleted network %s', id);
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

do_delete.synopses = ['{{name}} {{cmd}} NETWORK [NETWORK ...]'];

do_delete.help = [
    'Remove a fabric network.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where NETWORK is a network id (full UUID), name, or short id.'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritonnetwork'];

module.exports = do_delete;
