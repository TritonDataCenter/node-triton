/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 *
 * `triton network create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var jsprim = require('jsprim');

var common = require('../common');
var errors = require('../errors');



function do_create(subcmd, opts, args, cb) {
    assert.optionalString(opts.name, 'opts.name');
    assert.optionalString(opts.subnet, 'opts.subnet');
    assert.optionalString(opts.start_ip, 'opts.start_ip');
    assert.optionalString(opts.end_ip, 'opts.end_ip');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalString(opts.gateway, 'opts.gateway');
    assert.optionalArrayOfString(opts.resolver, 'opts.resolver');
    assert.optionalArrayOfString(opts.route, 'opts.route');
    assert.optionalBool(opts.no_nat, 'opts.no_nat');
    assert.optionalBool(opts.json, 'opts.json');
    assert.optionalBool(opts.help, 'opts.help');
    assert.func(cb, 'cb');

    var i;

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

    if (!opts.subnet) {
        cb(new errors.UsageError('must specify --subnet (-s) option'));
        return;
    }

    if (!opts.name) {
        cb(new errors.UsageError('must specify --name (-n) option'));
        return;
    }

    if (!opts.start_ip) {
        cb(new errors.UsageError('must specify --start-ip (-S) option'));
        return;
    }

    if (!opts.end_ip) {
        cb(new errors.UsageError('must specify --end-ip (-E) option'));
        return;
    }

    var createOpts = {
        vlan_id: vlanId,
        name: opts.name,
        subnet: opts.subnet,
        provision_start_ip: opts.start_ip,
        provision_end_ip: opts.end_ip,
        resolvers: [],
        routes: {}
    };

    if (opts.resolver) {
        for (i = 0; i < opts.resolver.length; i++) {
            if (createOpts.resolvers.indexOf(opts.resolver[i]) === -1) {
                createOpts.resolvers.push(opts.resolver[i]);
            }
        }
    }

    if (opts.route) {
        for (i = 0; i < opts.route.length; i++) {
            var m = opts.route[i].match(new RegExp('^([^=]+)=([^=]+)$'));

            if (m === null) {
                cb(new errors.UsageError('invalid route: ' + opts.route[i]));
                return;
            }

            createOpts.routes[m[1]] = m[2];
        }
    }

    if (opts.no_nat) {
        createOpts.internet_nat = false;
    }

    if (opts.gateway) {
        createOpts.gateway = opts.gateway;
    } else {
        if (!opts.no_nat) {
            cb(new errors.UsageError('without a --gateway (-g), you must ' +
              'specify --no-nat (-x)'));
            return;
        }
    }

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
        group: 'Create options'
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
        group: ''
    },
    {
        names: ['subnet', 's'],
        type: 'string',
        helpArg: 'SUBNET',
        help: 'A CIDR string describing the NETWORK.'
    },
    {
        names: ['start-ip', 'S', 'start_ip'],
        type: 'string',
        helpArg: 'START_IP',
        help: 'First assignable IP address on NETWORK.'
    },
    {
        names: ['end-ip', 'E', 'end_ip'],
        type: 'string',
        helpArg: 'END_IP',
        help: 'Last assignable IP address on NETWORK.'
    },
    {
        group: ''
    },
    {
        names: ['gateway', 'g'],
        type: 'string',
        helpArg: 'IP',
        help: 'Default gateway IP address.'
    },
    {
        names: ['resolver', 'r'],
        type: 'arrayOfString',
        helpArg: 'RESOLVER',
        help: 'DNS resolver IP address.  Specify multiple -r options for ' +
            'multiple resolvers.'
    },
    {
        names: ['route', 'R'],
        type: 'arrayOfString',
        helpArg: 'SUBNET=IP',
        help: [ 'Static route for network.  Each route must include the',
            'subnet (IP address with CIDR prefix length) and the router',
            'address.  Specify multiple -R options for multiple static',
            'routes.' ].join(' ')
    },
    {
        group: ''
    },
    {
        names: ['no-nat', 'x', 'no_nat'],
        type: 'bool',
        helpArg: 'NO_NAT',
        help: 'Disable creation of an Internet NAT zone on GATEWAY.'
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
    'Create a network on a VLAN.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Examples:',
    '    Create the "accounting" network on VLAN 1000:',
    '        triton network create -n accounting --subnet 192.168.0.0/24 \\',
    '            --start-ip 192.168.0.1 --end-ip 192.168.0.254 --no-nat \\',
    '            1000',
    '',
    '    Create the "eng" network on VLAN 1001 with a pair of static routes:',
    '        triton network create -n eng -s 192.168.1.0/24 \\',
    '            -S 192.168.1.1 -E 192.168.1.249 --no-nat \\',
    '            --route 10.1.1.0/24=192.168.1.50 \\',
    '            --route 10.1.2.0/24=192.168.1.100 \\',
    '            1001',
    '',
    '    Create the "ops" network on VLAN 1002 with DNS resolvers and NAT:',
    '        triton network create -n ops -s 192.168.2.0/24 \\',
    '            -S 192.168.2.10 -E 192.168.2.249 \\',
    '            --resolver 8.8.8.8 --resolver 8.4.4.4 \\',
    '            --gateway 192.168.2.1 \\',
    '            1002'
].join('\n');

do_create.helpOpts = {
    helpCol: 16
};

module.exports = do_create;
