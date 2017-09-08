/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network set-default ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_set_default(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing NETWORK argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.getNetwork(args[0], function onNetwork(err, net) {
            if (err) {
                cb(err);
                return;
            }

            var params = {
                default_network: net.id
            };

            var cloudapi = cli.tritonapi.cloudapi;

            cloudapi.updateConfig(params, function onUpdate(err2) {
                if (err2) {
                    cb(err2);
                    return;
                }

                console.log('Set network %s (%s) as default.', net.name,
                            net.id);
                cb();
            });
        });
    });
}


do_set_default.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_set_default.synopses = ['{{name}} {{cmd}} NETWORK'];

do_set_default.help = [
    'Set default network.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where NETWORK is a network id (full UUID), name, or short id.'
].join('\n');

do_set_default.completionArgtypes = ['tritonnetwork'];

module.exports = do_set_default;
