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
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_enable(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('Missing FWRULE-ID argument(s)'));
        return;
    }

    var cli = this.top;

    vasync.forEachParallel({
        inputs: args,
        func: function enableOne(id, nextId) {
            if (common.isUUID(id)) {
                enable();
                return;
            }

            // we need to look up the full UUID if the given id is a short id
            cli.tritonapi.getFirewallRule(id, function onRule(err, fwrule) {
                if (err) {
                    nextId(err);
                    return;
                }

                id = fwrule.id;

                enable();
            });

            function enable() {
                cli.tritonapi.cloudapi.enableFirewallRule(id, function (err) {
                    if (err) {
                        nextId(err);
                        return;
                    }

                    console.log('Enabled firewall rule %s', id);
                    nextId();
                });
            }
        }
    }, cb);
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
    '     {{name}} enable FWRULE-ID [FWRULE-ID...]',
    '',
    '{{options}}'
].join('\n');

module.exports = do_enable;
