/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 *
 * `triton vpc create ...`
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
        cb(new errors.UsageError('missing CIDR block'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cidr = args[0];

    if (typeof (cidr) !== 'string') {
        cb(new errors.UsageError('CIDR must be a string'));
        return;
    }

    if (!opts.name) {
        cb(new errors.UsageError('must provide a --name (-n)'));
        return;
    }

    var createOpts = {
        name: opts.name,
        ip4_cidr: cidr
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
        cloudapi.createVPC(createOpts, function onCreate(err, vpc) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(vpc));
            } else {
                if (vpc.name) {
                    console.log('Created VPC %s (%s)', vpc.name,
                                vpc.vpc_id);
                } else {
                    console.log('Created vlan %s', vpc.vpc_id);
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
        help: 'Name of the VPC.'
    },
    {
        names: ['description', 'D'],
        type: 'string',
        helpArg: 'DESC',
        help: 'Description of the VPC.'
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

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] CIDR'];

do_create.help = [
    'Create a VPC.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Example:',
    '    triton vpc create -n "prod" -D "Production VPC" 192.168.0.0/16'
].join('\n');

do_create.helpOpts = {
    helpCol: 16
};

module.exports = do_create;
