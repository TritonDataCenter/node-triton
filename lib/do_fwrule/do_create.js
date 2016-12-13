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
        cb(new errors.UsageError('missing FWRULE argument'));
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

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        tritonapi.cloudapi.createFirewallRule(
            createOpts, function (err, fwrule) {
                if (err) {
                    cb(err);
                    return;
                }
                console.log('Created firewall rule %s%s', fwrule.id,
                            (!fwrule.enabled ? ' (disabled)' : ''));
                cb();
            });
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
        helpArg: 'DESC',
        help: 'Description of the firewall rule.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] RULE-TEXT'];

do_create.help = [
    /* BEGIN JSSTYLED */
    'Create a firewall rule.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Examples:',
    '    # Allow SSH access from any IP to all instances in a datacenter.',
    '    triton fwrule create -D "ssh" "FROM any TO all vms ALLOW tcp PORT 22"',
    '',
    '    # Allow SSH access to a specific instance.',
    '    triton fwrule create \\',
    '        "FROM any TO vm ba2c95e9-1cdf-4295-8253-3fee371374d9 ALLOW tcp PORT 22"'
    // TODO: link to
    // https://github.com/joyent/sdc-fwrule/blob/master/docs/examples.md
    // or docs.jo Cloud Firewall examples? What link? Ditto in parent.
    /* END JSSTYLED */
].join('\n');

do_create.helpOpts = {
    helpCol: 25
};

module.exports = do_create;
