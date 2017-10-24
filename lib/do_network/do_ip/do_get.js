/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network ip get ...`
 */

var format = require('util').format;

var common = require('../../common');
var errors = require('../../errors');

function do_get(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        return cb(new errors.UsageError(format(
            'incorrect number of args (%d)', args.length)));
    }

    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        var getIpOpts = {
            id: args[0],
            ip: args[1]
        };

        tritonapi.getNetworkIp(getIpOpts, function (err, ip, res) {
            if (err) {
                return cb(err);
            }

            if (opts.json) {
                console.log(JSON.stringify(ip));
            } else {
                console.log(JSON.stringify(ip, null, 4));
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
        help: 'JSON output.'
    }
];

do_get.synopses = ['{{name}} {{cmd}} NETWORK IP'];

do_get.help = [
    'Show a network ip.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where NETWORK is a network id, and IP is the ip address you want to get.'
].join('\n');

do_get.completionArgtypes = ['tritonnetwork', 'tritonnetworkip', 'none'];

module.exports = do_get;
