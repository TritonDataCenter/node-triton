/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 *
 * `triton vlan create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var jsprim = require('jsprim');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_create(subcmd, opts, args, cb) {
    assert.optionalString(opts.name, 'opts.name');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalBool(opts.json, 'opts.json');
    assert.optionalBool(opts.help, 'opts.help');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length === 0) {
        cb(new errors.UsageError('missing VLAN argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var vlanId = jsprim.parseInteger(args[0], { allowSign: false });
    if (typeof (vlanId) !== 'number') {
        cb(new errors.UsageError('VLAN must be an integer'));
        return;
    }

    if (!opts.name) {
        cb(new errors.UsageError('must provide a --name (-n)'));
        return;
    }

    var createOpts = {
        vlan_id: vlanId,
        name: opts.name
    };

    if (opts.description) {
        createOpts.description = opts.description;
    }

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        var cloudapi = cli.tritonapi.cloudapi;
        cloudapi.createFabricVlan(createOpts, function onCreate(err, vlan) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(vlan));
            } else {
                if (vlan.name) {
                    console.log('Created vlan %s (%d)', vlan.name,
                                vlan.vlan_id);
                } else {
                    console.log('Created vlan %d', vlan.vlan_id);
                }
            }

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
        group: 'Create options'
    },
    {
        names: ['name', 'n'],
        type: 'string',
        helpArg: 'NAME',
        help: 'Name of the VLAN.'
    },
    {
        names: ['description', 'D'],
        type: 'string',
        helpArg: 'DESC',
        help: 'Description of the VLAN.'
    },
    {
        group: 'Other options'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] VLAN'];

do_create.help = [
    'Create a VLAN.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Example:',
    '    triton vlan create -n "dmz" -D "Demilitarized zone" 73'
].join('\n');

do_create.helpOpts = {
    helpCol: 16
};

module.exports = do_create;
