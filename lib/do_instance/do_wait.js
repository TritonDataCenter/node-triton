/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance wait ...`
 */

var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');


function do_wait(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length < 1) {
        return cb(new errors.UsageError('missing INST arg(s)'));
    }
    var ids = args;
    var states = [];
    opts.states.forEach(function (s) {
        /* JSSTYLED */
        states = states.concat(s.trim().split(/\s*,\s*/g));
    });

    var distraction;
    var done = 0;
    var instFromId = {};

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function getInsts(_, next) {
            vasync.forEachParallel({
                inputs: ids,
                func: function getInst(id, nextInst) {
                    self.top.tritonapi.getInstance(id, function (err, inst) {
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

            /*
             * TODO: need BigSpinner.log first.
             * TODO: Also when adding a spinner, we need an equiv option to
             * `triton create -wwww` to trigger the spinner (and size). By
             * default: no spinner.
             */
            if (false &&
                process.stderr.isTTY)
            {
                distraction = distractions.createDistraction();
            }

            vasync.forEachParallel({
                inputs: idsToWaitFor,
                func: function waitForInst(id, nextInst) {
                    self.top.tritonapi.cloudapi.waitForMachineStates({
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

do_wait.synopses = ['{{name}} {{cmd}} [-s STATES] INST [INST ...]'];
do_wait.help = [
    /* BEGIN JSSTYLED */
    'Wait on instances changing state.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id; and "STATES" is a',
    'comma-separated list of target instance states, by default "running,failed".',
    'In other words, "triton inst wait foo0" will wait for instance "foo0" to',
    'complete provisioning.'
    /* END JSSTYLED */
].join('\n');
do_wait.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['states', 's'],
        type: 'arrayOfString',
        default: ['running', 'failed'],
        helpArg: 'STATES',
        help: 'Instance states on which to wait. Default is "running,failed". '
            + 'Values can be comma-separated or multiple uses of the option.'
    }
];

do_wait.completionArgtypes = ['tritoninstance'];

module.exports = do_wait;
