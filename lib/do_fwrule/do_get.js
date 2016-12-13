/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton fwrule get ...`
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
        cb(new errors.UsageError('missing FWRULE argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];
    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        tritonapi.getFirewallRule(id, function onRule(err, fwrule) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(fwrule));
            } else {
                console.log(JSON.stringify(fwrule, null, 4));
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

do_get.synopses = ['{{name}} {{cmd}} FWRULE'];

do_get.help = [
    'Show a specific firewall rule.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where FWRULE is a firewall rule id (full UUID) or short id.'
].join('\n');

do_get.completionArgtypes = ['tritonfwrule', 'none'];

module.exports = do_get;
