/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton info ...`
 */

var common = require('./common');
var f = require('util').format;

var prettybytes = require('pretty-bytes');

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
        if (opts.json) {
            console.log(JSON.stringify(out));
        } else {
            // pretty print
            console.log('%s - %s %s <%s>',
                out.account.login,
                out.account.firstName,
                out.account.lastName,
                out.account.email);
            console.log(self.triton.cloudapi.url);
            console.log();
            console.log('%d instance(s)', out.machines.length);
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
            Object.keys(states).forEach(function (state) {
                console.log('- %d %s', states[state], state);
            });
            console.log('- %s RAM Total', prettybytes(memory * 1000 * 1000));
            console.log('- %s Disk Total', prettybytes(disk * 1000 * 1000));
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
    'Show account information\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} account\n'
    + '\n'
    + '{{options}}'
);

do_info.aliases = ['whoami'];

module.exports = do_info;
