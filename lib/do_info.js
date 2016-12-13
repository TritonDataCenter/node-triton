/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton info ...`
 */

var assert = require('assert-plus');
var common = require('./common');
var format = require('util').format;


function do_info(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var out = {};
    var i = 0;
    var tritonapi = this.tritonapi;

    common.cliSetupTritonApi({cli: this}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        tritonapi.cloudapi.getAccount(cb.bind('account'));    i++;
        tritonapi.cloudapi.listMachines(cb.bind('machines')); i++;

        function cb(err, data) {
            if (err) {
                callback(err);
                return;
            }
            out[this.toString()] = data;
            if (--i === 0)
                done();
        }

        function done() {
            // parse name
            var name;
            if (out.account.firstName && out.account.lastName)
                name = format('%s %s', out.account.firstName,
                              out.account.lastName);
            else if (out.account.firstName)
                name = out.account.firstName;

            // parse machine states and accounting
            var states = {};
            var disk = 0;
            var memory = 0;
            out.machines.forEach(function (machine) {
                var state = machine.state;
                states[state] = states[state] || 0;
                states[state]++;
                memory += machine.memory;
                disk += machine.disk;
            });
            disk *= 1000 * 1000;
            memory *= 1000 * 1000;

            var data = {};
            data.login = out.account.login;
            if (name)
                data.name = name;
            data.email = out.account.email;
            data.url = self.tritonapi.cloudapi.url;
            data.totalDisk = disk;
            data.totalMemory = memory;

            if (opts.json) {
                data.totalInstances = out.machines.length;
                data.instances = states;
                console.log(JSON.stringify(data));
            } else {
                data.totalDisk = common.humanSizeFromBytes(disk);
                data.totalMemory = common.humanSizeFromBytes(memory);
                Object.keys(data).forEach(function (key) {
                    console.log('%s: %s', key, data[key]);
                });
                console.log('instances: %d', out.machines.length);
                Object.keys(states).forEach(function (key) {
                    console.log('    %s: %d', key, states[key]);
                });
            }
            callback();
        }
    });
}

do_info.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_info.synopses = ['{{name}} {{cmd}}'];

do_info.help = [
    'Print an account summary.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_info;
