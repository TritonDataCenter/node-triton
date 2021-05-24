/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 *
 * `triton instance nic create ...`
 */

var assert = require('assert-plus');

var common = require('../../common');
var errors = require('../../errors');

function do_create(subcmd, opts, args, cb) {
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalBool(opts.json, 'opts.json');
    assert.optionalBool(opts.help, 'opts.help');
    assert.optionalBool(opts.primary, 'opts.primary');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and NETWORK or INST and' +
            ' NICOPT=VALUE arguments'));
        return;
    }

    var cli = this.top;

    var netObj;
    var netObjArgs = [];
    var regularArgs = [];
    var createOpts = {};

    args.forEach(function forEachArg(arg) {
        if (arg.indexOf('=') !== -1) {
            netObjArgs.push(arg);
            return;
        }
        regularArgs.push(arg);
    });

    if (netObjArgs.length > 0) {
        if (regularArgs.length > 1) {
            cb(new errors.UsageError('cannot specify INST and NETWORK when'
                + ' passing in ipv4 arguments'));
            return;
        }
        if (regularArgs.length !== 1) {
            cb(new errors.UsageError('missing INST argument'));
            return;
        }

        try {
            netObj = common.parseNicStr(netObjArgs);
        } catch (err) {
            cb(err);
            return;
        }
    }

    if (netObj) {
        assert.array(regularArgs, 'regularArgs');
        assert.equal(regularArgs.length, 1, 'instance uuid');

        createOpts.id = regularArgs[0];
        createOpts.network = netObj;
        createOpts.primary = (opts.primary === true);
    } else {
        assert.array(args, 'args');
        assert.equal(args.length, 2, 'INST and NETWORK');

        createOpts.id = args[0];
        createOpts.network = args[1];
        createOpts.primary = (opts.primary === true);
    }

    function wait(instId, mac, next) {
        assert.string(instId, 'instId');
        assert.string(mac, 'mac');
        assert.func(next, 'next');

        var waiter = cli.tritonapi.waitForNicStates.bind(cli.tritonapi);

        /*
         * We request state running|stopped because net-agent is doing work to
         * keep a NICs state in sync with the VMs state. If a user adds a NIC
         * to a stopped instance the final state of the NIC should also be
         * stopped.
         */
        waiter({
            id: instId,
            mac: mac,
            states: ['running', 'stopped']
        }, next);
    }

    // same signature as wait(), but is a nop
    function waitNop(instId, mac, next) {
        assert.string(instId, 'instId');
        assert.string(mac, 'mac');
        assert.func(next, 'next');

        next();
    }

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.addNic(createOpts, function onAddNic(err, nic) {
            if (err) {
                cb(err);
                return;
            }

            // If a NIC exists on the network already we will receive a 302
            if (!nic) {
                var errMsg = 'Instance already has a NIC on that network';
                cb(new errors.TritonError(errMsg));
                return;
            }

            // either wait or invoke a nop stub
            var func = opts.wait ? wait : waitNop;

            if (opts.wait && !opts.json) {
                console.log('Creating NIC %s', nic.mac);
            }

            func(createOpts.id, nic.mac, function onWait(err2, createdNic) {
                if (err2) {
                    cb(err2);
                    return;
                }

                var nicInfo = createdNic || nic;

                if (opts.json) {
                    console.log(JSON.stringify(nicInfo));
                } else {
                    console.log('Created NIC %s', nic.mac);
                }

                cb();
            });
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
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the creation to complete.'
    },
    {
        names: ['primary', 'p'],
        type: 'bool',
        help: 'Make new NIC the primary NIC for the instance'
    }
];

do_create.synopses = [
    '{{name}} {{cmd}} [OPTIONS] INST NETWORK',
    '{{name}} {{cmd}} [OPTIONS] INST NICOPT=VALUE [NICOPT=VALUE ...]'
];

do_create.help = [
    'Create a NIC.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'INST is an instance id (full UUID), name, or short id,',
    'and NETWORK is a network id (full UUID), name, or short id.',
    '',
    'NICOPTs are NIC options. The following NIC options are supported:',
    'ipv4_uuid=<full network uuid> (required),' +
        ' and ipv4_ips=<a single IP string>.',
    '',
    'Be aware that adding NICs to an instance  will cause that instance to',
    'reboot.',
    '',
    'Example:',
    '    triton instance nic create --wait 22b75576 ca8aefb9',
    '    triton instance nic create 22b75576' +
            ' ipv4_uuid=651446a8-dab0-439e-a2c4-2c841ab07c51' +
            ' ipv4_ips=192.168.128.13'
].join('\n');

do_create.helpOpts = {
    helpCol: 25
};

do_create.completionArgtypes = ['tritoninstance', 'tritonnic', 'none'];

module.exports = do_create;
