/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton datacenter ...`
 */

var common = require('../common');

function do_get(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        tritonapi.cloudapi.getDatacenter(args[0], function (err, datacenter) {
            if (err) {
                callback(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(datacenter));
            } else {
                console.log(JSON.stringify(datacenter, null, 4));
            }
            callback();
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

do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] NAME'];

do_get.help = [
    'Show datacenter in this cloud.',
    'A "cloud" is a set of related datacenter that share account',
    'information.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "NAME" is an datacenter name.'
].join('\n');

module.exports = do_get;
