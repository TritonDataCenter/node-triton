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
    assert.optionalBool(opts.enabled, 'opts.enabled');
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

    opts.rule = args[0];

    var cli = this.top;
    cli.tritonapi.cloudapi.createFirewallRule(opts, function (err, fwrule) {
        if (err) {
            cb(err);
            return;
        }

        console.log('Created firewall rule %s', fwrule.id);

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
        names: ['enabled', 'e'],
        type: 'bool',
        help: 'If the firewall rule should be enabled upon creation.'
    },
    {
        names: ['description', 'd'],
        type: 'string',
        helpArg: '<description>',
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

module.exports = do_create;
