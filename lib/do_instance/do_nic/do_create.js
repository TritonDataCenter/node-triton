/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance nic create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;

var common = require('../../common');
var errors = require('../../errors');


function do_create(subcmd, opts, args, cb) {
    assert.optionalBool(opts.primary, 'opts.primary');
    assert.optionalBool(opts.wait, 'opts.wait');
    assert.optionalBool(opts.json, 'opts.json');
    assert.optionalBool(opts.help, 'opts.help');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and NETWORK arguments'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var createOpts = {
        id: args[0],
        network: args[1]
    };

    if (opts.primary) {
        createOpts.primary = opts.primary;
    }

    function wait(instId, mac, next) {
        var cloudapi = cli.tritonapi.cloudapi;
        var waiter = cloudapi.waitForNicStates.bind(cloudapi);

        waiter({
            id: instId,
            mac: mac,
            states: ['running']
        }, next);
    }

    // same signature as wait(), but is a nop
    function waitNop(instId, mac, next) {
        next();
    }

    var cli = this.top;

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

            if (!nic) {
                var errMsg = 'Instance already has a NIC on that network';
                cb(new errors.TritonError(errMsg));
                return;
            }

            // either wait or invoke a nop stub
            var func = opts.wait ? wait : waitNop;

            if (opts.wait && !opts.json)
                console.log('Creating NIC %s', nic.mac);

            func(createOpts.id, nic.mac, function (err2) {
                if (err2) {
                    cb(err2);
                    return;
                }

                if (opts.json) {
                    console.log(JSON.stringify(nic));
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
        names: ['primary'],
        type: 'bool',
        help: 'Make this the primary NIC of INST.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the creation to complete.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] INST NETWORK'];

do_create.help = [
    'Create a NIC.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id (full UUID), name, or short id,',
    'and NETWORK is a network id (full UUID), name, or short id.',
    '',
    'Be aware that adding NICs to an instance  will cause that instance to',
    'reboot.',
    '',
    'Example:',
    '    triton instance nic create --wait 22b75576 ca8aefb9'
].join('\n');

do_create.helpOpts = {
    helpCol: 25
};

do_create.completionArgtypes = ['tritoninstance', 'tritonnetwork', 'none'];

module.exports = do_create;
