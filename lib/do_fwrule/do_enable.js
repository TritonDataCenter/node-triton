/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton fwrule enable ...`
 */

var assert = require('assert-plus');

var common = require('../common');
var errors = require('../errors');


function do_enable(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('Missing FWRULE-ID argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('Incorrect number of arguments'));
        return;
    }

    var id = args[0];
    var cli = this.top;

    // XXX add support for shortId
    cli.tritonapi.cloudapi.enableFirewallRule(id, function onRule(err) {
        if (err) {
            cb(err);
            return;
        }

        console.log('Enabled firewall rule %s', id);

        cb();
    });
}


do_enable.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];
do_enable.help = [
    'Enable a specific firewall rule.',
    '',
    'Usage:',
    '     {{name}} enable FWRULE-ID',
    '',
    '{{options}}'
].join('\n');

module.exports = do_enable;
