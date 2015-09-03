/*
 * Copyright 2015 Joyent Inc.
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

    this.triton.cloudapi.getAccount(cb.bind('account'));    i++;
    this.triton.cloudapi.listMachines(cb.bind('machines')); i++;

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
        data.url = self.triton.cloudapi.url;
        data.totalInstances = out.machines.length;
        data.totalDisk = disk;
        data.totalMemory = memory;

        if (opts.json) {
            data.machines = states;
            console.log(JSON.stringify(data));
        } else {
            data.totalDisk = common.humanSizeFromBytes(disk);
            data.totalMemory = common.humanSizeFromBytes(memory);
            Object.keys(data).forEach(function (key) {
                console.log('%s: %s', key, data[key]);
            });
            Object.keys(states).forEach(function (key) {
                console.log('machines.%s: %s', key, states[key]);
            });
        }
        callback();
    }
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
do_info.help = (
    'Print an account summary.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} account\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_info;
