/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton key get ...`
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
        cb(new errors.UsageError('missing KEY argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];
    var cli = this.top;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        cli.tritonapi.cloudapi.getKey({
            // Currently `cloudapi.getUserKey` isn't picky about the
            // `name` being passed in as the `opts.fingerprint` arg.
            fingerprint: id
        }, function onKey(err, key) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(key));
            } else {
                console.log(common.chomp(key.key));
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

do_get.synopses = ['{{name}} {{cmd}} KEY'];

do_get.help = [
    'Show a specific SSH key in an account.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "KEY" is an SSH key "name" or "fingerprint".'
].join('\n');

do_get.completionArgtypes = ['tritonkey', 'none'];

module.exports = do_get;
