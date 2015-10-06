/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton stop-instance ...`
 * `triton start-instance ...`
 * `triton reboot-instance ...`
 */

var f = require('util').format;
var assert = require('assert-plus');
var common = require('./common');

var vasync = require('vasync');

function perror(err) {
    console.error('error: %s', err.message);
}

function do_startstop_instance(action) {
    assert.ok(['start', 'stop', 'reboot', 'delete'].indexOf(action) >= 0,
        'invalid action');

    function _do_startstop_instance(subcmd, opts, args, callback) {
        return _do_instance.call(this, action, subcmd, opts, args, callback);
    }

    _do_startstop_instance.aliases = [action];
    _do_startstop_instance.help = [
        f('%s a single instance.', common.capitalize(action)),
        f(''),
        f('Usage:'),
        f('       {{name}} %s <alias|id> ...', action),
        f(''),
        f('{{options}}')
    ].join('\n');
    _do_startstop_instance.options = [
        {
            names: ['help', 'h'],
            type: 'bool',
            help: 'Show this help.'
        },
        {
            names: ['wait', 'w'],
            type: 'bool',
            help: 'Block until desired state is reached.'
        }
    ];

    return _do_startstop_instance;
}

function _do_instance(action, subcmd, opts, args, callback) {
    var self = this;

    var now = Date.now();

    var command, state;
    switch (action) {
        case 'start':
            command = 'startMachine';
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
                self.tritonapi.getInstance(arg, function (err, inst) {
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
                self.tritonapi.cloudapi[command](uuid,
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

                    self.tritonapi.cloudapi.waitForMachineStates({
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

module.exports = do_startstop_instance;
