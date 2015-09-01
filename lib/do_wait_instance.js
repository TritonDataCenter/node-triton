/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton wait-instance ...`
 */

var vasync = require('vasync');

var distractions = require('./distractions');
var errors = require('./errors');


function do_wait_instance(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length < 1) {
        return cb(new errors.UsageError('missing INSTANCE arg(s)'));
    }
    var ids = args;
    var states = [];
    opts.states.forEach(function (s) {
        states = states.concat(s.trim().split(/\s*,\s*/g));
    });

    var distraction;
    var done = 0;
    var instFromId = {};

    vasync.pipeline({funcs: [
        function getInsts(_, next) {
            vasync.forEachParallel({
                inputs: ids,
                func: function getInst(id, nextInst) {
                    self.triton.getInstance(id, function (err, inst) {
                        if (err) {
                            return nextInst(err);
                        }
                        if (states.indexOf(inst.state) !== -1) {
                            console.log('%d/%d: Instance %s (%s) already %s',
                                ++done, ids.length, inst.name, id, inst.state);
                        } else {
                            instFromId[inst.id] = inst;
                        }
                        nextInst();
                    });
                }
            }, next);
        },

        function waitForInsts(_, next) {
            var idsToWaitFor = Object.keys(instFromId);
            if (idsToWaitFor.length === 0) {
                return next();
            }

            if (idsToWaitFor.length === 1) {
                var inst2 = instFromId[idsToWaitFor[0]];
                console.log(
                    'Waiting for instance %s (%s) to enter state (states: %s)',
                    inst2.name, inst2.id, states.join(', '));
            } else {
                console.log(
                    'Waiting for %d instances to enter state (states: %s)',
                    idsToWaitFor.length, states.join(', '));
            }

            if (false /* TODO: need BigSpinner.log first */
                && !opts.quiet && process.stderr.isTTY)
            {
                distraction = distractions.createDistraction();
            }

            vasync.forEachParallel({
                inputs: idsToWaitFor,
                func: function waitForInst(id, nextInst) {
                    self.triton.cloudapi.waitForMachineStates({
                        id: id,
                        states: states
                    }, function (err, inst, res) {
                        if (err) {
                            return nextInst(err);
                        }
                        console.log('%d/%d: Instance %s (%s) moved to state %s',
                            ++done, ids.length, inst.name, inst.id, inst.state);
                        nextInst();
                    });
                }
            }, next);
        }

    ]}, function (err) {
        if (distraction) {
            distraction.destroy();
        }
        cb(err);
    });
}

do_wait_instance.aliases = ['wait'];
do_wait_instance.help = [
    'Wait on instances changing state.',
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
        help: 'No progress spinner while waiting.'
    },
    {
        names: ['states', 's'],
        type: 'arrayOfString',
        default: ['running', 'failed'],
        helpArg: 'STATES',
        help: 'Instance states on which to wait. Default is "running,failed".'
            + 'Values can be comma-separated or multiple uses of the option.'
    }
];

module.exports = do_wait_instance;
