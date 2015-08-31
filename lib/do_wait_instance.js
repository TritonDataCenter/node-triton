/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton wait-instance ...`
 */

var format = require('util').format;

var common = require('./common');
var errors = require('./errors');



function do_wait_instance(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length < 1) {
        return cb(new errors.UsageError(format(
            'incorrect number of args (%d): %s', args.length, args.join(' '))));
    }
    var ids = args;
    var states = [];
    opts.states.forEach(function (s) {
        states = states.concat(s.trim().split(/\s*,\s*/g));
    });

    function log() {
        if (!opts.quiet)
            console.log.apply(console, arguments);
    }

    var done = 0;

    var machines = {};

    var i = 0;
    ids.forEach(function (id) {
        i++;
        if (common.isUUID(id)) {
            machines[id] = {};
            go1();
            return;
        }

        self.triton.getInstance(id, function (err, machine) {
            if (err) {
                cb(err);
                return;
            }
            if (states.indexOf(machine.state) >= 0) {
                // machine in acceptable state already... skip it
                log('%d/%d: %s already in acceptable state: %s',
                    ++done, ids.length, id, machine.state);
            } else {
                machines[machine.id] = machine;
            }
            go1();
        });
    });

    function go1() {
        if (--i > 0)
            return;

        var uuids = Object.keys(machines);
        var num = uuids.length;
        i = num;

        if (num === 0) {
            cb();
            return;
        }

        uuids.forEach(function (id) {
            var opts = {
                id: id,
                states: states
            };
            self.triton.cloudapi.waitForMachineStates(opts, function (err, body, res) {
                if (err) {
                    cb(err);
                    return;
                }
                log('%d/%d: %s moved to state %s',
                    ++done, ids.length, body.name, body.state);
                if (--i === 0) {
                    cb();
                }
            });
        });
    }
}

do_wait_instance.aliases = ['wait'];
do_wait_instance.help = [
    'Wait on instances moving to given states.',
    '',
    'Usage:',
    '       {{name}} wait [-s STATES] INSTANCE [INSTANCE ...]',
    '',
    '{{options}}',
    'Where "states" is a comma-separated list of target instance states,',
    'by default "running,failed". In other words, "triton wait foo0" will',
    'wait for instance "foo0" to complete provisioning.'
].join('\n');
do_wait_instance.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Disable all output.'
    },
    {
        names: ['states', 's'],
        type: 'arrayOfString',
        default: ['running', 'failed'],
        helpArg: 'STATES',
        help: 'Instance states on which to wait. Default is "running,failed".'
            + 'Values can be comma-separated or multiple uses of the option.'
    },
];

module.exports = do_wait_instance;
