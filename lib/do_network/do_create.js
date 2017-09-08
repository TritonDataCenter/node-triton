/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;

var common = require('../common');
var errors = require('../errors');


var OPTIONAL_OPTS = ['description', 'gateway', 'resolvers', 'routes'];


function do_create(subcmd, opts, args, cb) {
    assert.optionalString(opts.name, 'opts.name');
    assert.optionalString(opts.subnet, 'opts.subnet');
    assert.optionalString(opts.start_ip, 'opts.start_ip');
    assert.optionalString(opts.end_ip, 'opts.end_ip');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalString(opts.gateway, 'opts.gateway');
    assert.optionalString(opts.resolvers, 'opts.resolvers');
    assert.optionalString(opts.routes, 'opts.routes');
    assert.optionalBool(opts.no_nat, 'opts.no_nat');
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

    var createOpts = {
        vlan_id: +args[0],
        name:    opts.name,
        subnet:  opts.subnet,
        provision_start_ip: opts.start_ip,
        provision_end_ip:   opts.end_ip
    };

    if (opts.no_nat) {
        createOpts.internet_nat = false;
    }

    OPTIONAL_OPTS.forEach(function (attr) {
        if (opts[attr]) {
            createOpts[attr] = opts[attr];
        }
    });

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        var cloudapi = cli.tritonapi.cloudapi;

        cloudapi.createFabricNetwork(createOpts, function onCreate(err, net) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(net));
            } else {
                console.log('Created network %s (%s)', net.name, net.id);
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
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {
        names: ['name', 'n'],
        type: 'string',
        helpArg: 'NAME',
        help: 'Name of the NETWORK.'
    },
    {
        names: ['description', 'D'],
        type: 'string',
        helpArg: 'DESC',
        help: 'Description of the NETWORK.'
    },
    {
        names: ['subnet'],
        type: 'string',
        helpArg: 'SUBNET',
        help: 'A CIDR string describing the NETWORK.'
    },
    {
        names: ['start_ip'],
        type: 'string',
        helpArg: 'START_IP',
        help: 'First assignable IP address on NETWORK.'
    },
    {
        names: ['end_ip'],
        type: 'string',
        helpArg: 'END_IP',
        help: 'Last assignable IP address on NETWORK.'
    },
    {
        names: ['gateway'],
        type: 'string',
        helpArg: 'GATEWAY',
        help: 'Gateway IP address.'
    },
    {
        names: ['resolvers'],
        type: 'string',
        helpArg: 'RESOLVERS',
        help: 'Resolver IP addresses.'
    },
    {
        names: ['routes'],
        type: 'string',
        helpArg: 'ROUTES',
        help: 'Static routes for hosts on NETWORK.'
    },
    {
        names: ['no_nat'],
        type: 'bool',
        helpArg: 'NO_NAT',
        help: 'Disable creation of an Internet NAT zone on GATEWAY.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] VLAN'];

do_create.help = [
    'Create a network on a VLAN.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Example:',
    '    triton network create -n accounting --subnet=192.168.0.0/24',
    '           --start_ip=192.168.0.1 --end_ip=192.168.0.254'
].join('\n');

do_create.helpOpts = {
    helpCol: 25
};

module.exports = do_create;
