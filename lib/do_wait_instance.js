/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton wait-instance ...`
 */

var common = require('./common');

function do_wait_instance(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1 || args.length > 2) {
        cb(new Error('invalid args: ' + args));
        return;
    }

    function log() {
        if (!opts.quiet)
            console.log.apply(console, arguments);
    }

    var ids = args[0].split(',');
    var states = (args[1] || 'failed,running').split(',');
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
    '       {{name}} wait <name|id> [<states>]',
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
];

module.exports = do_wait_instance;
