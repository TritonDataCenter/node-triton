/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * Shared support for:
 * `triton instance start ...`
 * `triton instance stop ...`
 * `triton instance reboot ...`
 * `triton instance delete ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');


var f = require('util').format;


function perror(err) {
    console.error('error: %s', err.message);
}


function gen_do_ACTION(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.action, 'opts.action');
    assert.optionalArrayOfString(opts.aliases, 'opts.aliases');
    var action = opts.action;

    assert.ok(['start', 'stop', 'reboot', 'delete'].indexOf(action) >= 0,
        'invalid action');

    function do_ACTION(subcmd, _opts, args, callback) {
        return _doTheAction.call(this, action, subcmd, _opts, args, callback);
    }

    if (opts.aliases) {
        do_ACTION.aliases = opts.aliases;
    }

    do_ACTION.help = [
        f('%s one or more instances.', common.capitalize(action)),
        f(''),
        f('Usage:'),
        f('     {{name}} %s <alias|id> ...', action),
        f(''),
        f('{{options}}')
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

    if (action === 'start') {
        do_ACTION.options.push({
            names: ['snapshot'],
            type: 'string',
            help: 'Name of snapshot to start machine with.'
        });
    }

    return do_ACTION;
}

function _doTheAction(action, subcmd, opts, args, callback) {
    var self = this;

    var now = Date.now();

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
        case 'reboot':
            command = 'rebootMachine';
            state = 'running';
            break;
        case 'delete':
            command = 'deleteMachine';
            state = 'deleted';
            break;
        default:
            callback(new Error('unknown action: ' + action));
            break;
    }

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    vasync.forEachParallel({
        func: function (arg, cb) {
            var alias, uuid;
            if (common.isUUID(arg)) {
                uuid = arg;
                done();
            } else {
                self.top.tritonapi.getInstance(arg, function (err, inst) {
                    if (err) {
                        perror(err);
                        cb(err);
                        return;
                    }
                    alias = arg;
                    uuid = inst.id;
                    done();
                });
            }

            // called when "uuid" is set
            function done() {
                var cOpts = uuid;
                if (command === 'startMachineFromSnapshot') {
                    cOpts = { id: uuid, name: opts.snapshot };
                }

                self.top.tritonapi.cloudapi[command](cOpts,
                    function (err, body, res) {

                    if (err) {
                        perror(err);
                        cb(err);
                        return;
                    }

                    if (!opts.wait) {
                        if (alias)
                            console.log('%s (async) instance %s (%s)',
                                common.capitalize(action), alias, uuid);
                        else
                            console.log('%s (async) instance %s',
                                common.capitalize(action), uuid);
                        cb();
                        return;
                    }

                    self.top.tritonapi.cloudapi.waitForMachineStates({
                        id: uuid,
                        states: [state]
                    }, function (err2, inst2, res2) {
                        if (action === 'delete' &&
                            res2 && res2.statusCode === 410) {
                            // This is success, fall through to bottom.
                            /* jsl:pass */
                        } else if (err2) {
                            perror(err2);
                            cb(err2);
                            return;
                        }

                        var dur = common.humanDurationFromMs(Date.now() - now);
                        if (alias)
                            console.log('%s instance %s (%s, %s)',
                                common.capitalize(action), alias, uuid, dur);
                        else
                            console.log('%s instance %s (%s)',
                                common.capitalize(action), uuid, dur);

                        cb();
                    });
                });
            }
        },
        inputs: args
    }, function (err, results) {
        var e = err ? (new Error('command failure')) : null;
        callback(e);
    });
}

module.exports = gen_do_ACTION;
