/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton fwrule create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_create(subcmd, opts, args, cb) {
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalBool(opts.disabled, 'opts.disabled');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length === 0) {
        cb(new errors.UsageError('missing <fwrule> argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var createOpts = {
        rule: args[0]
    };
    if (!opts.disabled) {
        createOpts.enabled = true;
    }
    if (opts.description) {
        createOpts.description = opts.description;
    }

    this.top.tritonapi.cloudapi.createFirewallRule(createOpts,
            function (err, fwrule) {
        if (err) {
            cb(err);
            return;
        }
        console.log('Created firewall rule %s%s', fwrule.id,
            (!fwrule.enabled ? ' (disabled)' : ''));
        cb();
    });
}


do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {
        names: ['disabled', 'd'],
        type: 'bool',
        help: 'Disable the created firewall rule. By default a created '
            + 'firewall rule is enabled. Use "triton fwrule enable" '
            + 'to enable it later.'
    },
    {
        names: ['description', 'D'],
        type: 'string',
        helpArg: '<desc>',
        help: 'Description of the firewall rule.'
    }
];
do_create.help = [
    'Create a firewall rule.',
    '',
    'Usage:',
    '    {{name}} create [<options>] <fwrule>',
    '',
    '{{options}}'
].join('\n');

do_create.helpOpts = {
    helpCol: 25
};

module.exports = do_create;
