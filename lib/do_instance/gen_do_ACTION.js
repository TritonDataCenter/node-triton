/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * Shared support for:
 * `triton instance start ...`
 * `triton instance stop ...`
 * `triton instance delete ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');
var format = require('util').format;

var common = require('../common');
var errors = require('../errors');


function perror(err) {
    console.error('error: %s', err.message);
}


function gen_do_ACTION(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.action, 'opts.action');
    assert.optionalArrayOfString(opts.aliases, 'opts.aliases');
    var action = opts.action;

    assert.ok(['start', 'stop', 'delete'].indexOf(action) >= 0,
        'invalid action');

    function do_ACTION(subcmd, _opts, args, callback) {
        return _doTheAction.call(this, action, subcmd, _opts, args, callback);
    }
    do_ACTION.name = 'do_' + action;

    if (opts.aliases) {
        do_ACTION.aliases = opts.aliases;
    }

    do_ACTION.synopses = ['{{name}} ' + action + ' [OPTIONS] INST [INST ...]'];
    do_ACTION.help = [
        common.capitalize(action) + ' one or more instances.',
        '',
        '{{usage}}',
        '',
        '{{options}}',
        'Where "INST" is an instance name, id, or short id.'
    ].join('\n');
    do_ACTION.options = [
        {
            names: ['help', 'h'],
            type: 'bool',
            help: 'Show this help.'
        },
        {
            names: ['wait', 'w'],
            type: 'bool',
            help: 'Block until instance state indicates the action is complete.'
        }
    ];

    do_ACTION.completionArgtypes = ['tritoninstance'];

    if (action === 'start') {
        do_ACTION.options.push({
            names: ['snapshot'],
            type: 'string',
            help: 'Name of snapshot with which to start the instance.',
            helpArg: 'SNAPNAME'
        });
    }

    if (action === 'start' || action === 'delete') {
        do_ACTION.options.push({
            names: ['wait-timeout'],
            type: 'positiveInteger',
            default: 120,
            help: 'The number of seconds to wait before timing out with an '
                + 'error. The default is 120 seconds.'
        });
    }

    return do_ACTION;
}

function _doTheAction(action, subcmd, opts, args, callback) {
    var self = this;

    var command, state;
    switch (action) {
        case 'start':
            command = opts.snapshot ? 'startMachineFromSnapshot' :
                                      'startMachine';
            state = 'running';
            break;
        case 'stop':
            command = 'stopMachine';
            state = 'stopped';
            break;
        case 'delete':
            command = 'deleteMachine';
            state = 'deleted';
            break;
        default:
            // Do nothing. Want explicit return call after callback invocation.
            break;
    }

    if (!command) {
        callback(new Error('unknown action: ' + action));
        return;
    }

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1) {
        callback(new errors.UsageError('missing INST arg(s)'));
        return;
    }
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
            return;
        }
        _doOnEachInstance(self, action, command, state, args, opts, callback);
    });
}

function _doOnEachInstance(target, action, command, state, instances,
                           opts, callback) {
    var tritonapi = self.top.tritonapi;
    var cloudapi = tritonapi.cloudapi;
    var now = Date.now();

    vasync.forEachParallel({
        func: function (arg, cb) {
            var alias, uuid;
            if (common.isUUID(arg)) {
                uuid = arg;
                done();
                return;
            } else {
                target.top.tritonapi.getInstance(arg, function (err, inst) {
                    if (err) {
                        perror(err);
                        cb(err);
                        return;
                    }
                    alias = arg;
                    uuid = inst.id;
                    if (!opts.snap) {
                        done();
                        return;
                    }
                    target.top.tritonapi.getInstanceSnapshot({
                        id: uuid,
                        name: opts.snapshot
                    }, function getSnapCb(snapErr, _snap, _snapRes) {
                        if (snapErr) {
                            perror(snapErr);
                            cb(snapErr);
                            return;
                        }
                        done();
                    });
                });
            }

            tritonapi.getInstance(arg, function getInstCb(err, inst) {
                if (err) {
                    perror(err);
                    cb(err);
                    return;
                }

                alias = arg;
                uuid = inst.id;
                doAction();
            });

            // called when "uuid" is set
            function doAction() {
                var cOpts = uuid;
                var wait = waitOnState;

                if (command === 'startMachineFromSnapshot') {
                    cOpts = { id: uuid, name: opts.snapshot };
                    wait = waitOnJob;
                } else if (command === 'deleteMachine') {
                    wait = waitOnJob;
                }

                cloudapi[command](cOpts, function commandCb(err, body, res) {
                    if (err) {
                        perror(err);
                        cb(err);
                        return;
                    }

                    res = res || body; // delete callbacks return (err, res)
                    if (opts.wait) {
                        wait(res.headers['date'],
                             res.headers['request-id'],
                             opts.wait_timeout);
                        return;
                    }

                    var actionStr = common.capitalize(action);
                    if (alias)
                        console.log('%s (async) instance %s (%s)', actionStr,
                            alias, uuid);
                    else
                        console.log('%s (async) instance %s', actionStr, uuid);
                    cb();
                });
            }

            function waitOnState(dateHeader, reqId, waitTimeout) {
                cloudapi.waitForMachineStates({
                    id: uuid,
                    states: [state]
                }, function waitMachineCb(err, inst, res) {
                    if (err) {
                        perror(err);
                        cb(err);
                        return;
                    }

                    report();
               });
            }

            /*
             * Polling on the instance `state` doesn't work for when switching
             * an instance to a snapshot, because a first poll value of
             * "running" is ambiguous: was it a fast reboot, or has the instance
             * not yet left the running state? Instead we check the audit log.
             */
            function waitOnJob(dateHeader, reqId, waitTimeout) {
                var resTime = Date.parse(dateHeader);

                if (!dateHeader) {
                    cb(new errors.InternalError(format(
                        'cannot wait for rollback_snapshot: CloudAPI ' +
                        'response did not include a "Date" header (req %s)',
                        reqId)));
                    return;
                } else if (isNaN(resTime)) {
                    cb(new errors.InternalError(format(
                        'cannot wait for reboot: could not parse CloudAPI ' +
                        'response "Date" header: "%s" (req %s)',
                        dateHeader, reqId)));
                    return;
                }

                if (waitTimeout !== undefined) {
                    waitTimeout *= 1000; // convert to ms
                }

                var auditAction;
                if (command === 'startMachineFromSnapshot') {
                    auditAction = 'rollback_snapshot';
                } else if (command === 'deleteMachine') {
                    auditAction = 'destroy';
                } else {
                    throw 'Unrecognized action'; // shouldn't get here
                }

                cloudapi.waitForAudit({
                    id: uuid,
                    action: auditAction,
                    minAge: resTime,
                    waitTimeout: waitTimeout
                }, function waitAuditCb(err) {
                    if (err) {
                        perror(err);
                        cb(err);
                        return;
                    }

                    report();
                });
            }

            function report() {
                var dur = common.humanDurationFromMs(Date.now() - now);
                if (alias)
                    console.log('%s instance %s (%s, %s)',
                        common.capitalize(action), alias, uuid, dur);
                else
                    console.log('%s instance %s (%s)',
                        common.capitalize(action), uuid, dur);

                cb();
            }
        },
        inputs: instances
    }, function (err, results) {
        var e = err ? (new Error('command failure')) : null;
        callback(e);
    });
}

module.exports = gen_do_ACTION;
