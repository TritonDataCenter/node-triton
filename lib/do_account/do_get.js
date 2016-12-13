/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton account get ...`
 */

var common = require('../common');

function do_get(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        tritonapi.cloudapi.getAccount(function (err, account) {
            if (err) {
                callback(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(account));
            } else {
                // pretty print
                var dates = ['updated', 'created'];
                Object.keys(account).forEach(function (key) {
                    var val = account[key];
                    if (dates.indexOf(key) >= 0) {
                        console.log('%s: %s (%s)', key, val,
                                    common.longAgo(new Date(val)));
                    } else {
                        console.log('%s: %s', key, val);
                    }
                });
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

do_get.synopses = ['{{name}} {{cmd}}'];

do_get.help = [
    'Show account information',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_get;
