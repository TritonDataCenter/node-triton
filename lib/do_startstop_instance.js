/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton stop-instance ...`
 * `triton start-instance ...`
 * `triton reboot-instance ...`
 */

var f = require('util').format;
var assert = require('assert-plus');
var common = require('./common');

function do_startstop_instance(action) {
    assert.ok(['start', 'stop', 'reboot'].indexOf(action) >= 0,
        'invalid action');

    function _do_startstop_instance(subcmd, opts, args, callback) {
        return _do_instance.call(this, action, subcmd, opts, args, callback);
    }

    _do_startstop_instance.aliases = [action];
    _do_startstop_instance.help = [
        f('%s a single instance.', action),
        f(''),
        f('Usage:'),
        f('       {{name}} %s <alias|id>', action),
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
        },
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
    }

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var arg = args[0];
    var uuid, alias;

    if (common.isUUID(arg)) {
        uuid = arg;
        go1();
    } else {
        self.triton.getMachineByAlias(arg, function (err, machine) {
            if (err) {
                callback(err);
                return;
            }
            alias = arg;
            uuid = machine.id;
            go1();
        });
    }

    function go1() {
        // called when "uuid" is set
        self.triton.cloudapi[command](uuid, function (err, body, res) {
            if (err) {
                callback(err);
                return;
            }

            if (!opts.wait) {
                if (alias)
                    console.log('%s (async) instance %s (%s)', common.capitalize(action), alias, uuid);
                else
                    console.log('%s (async) instance %s', common.capitalize(action), uuid);
                callback();
                return;
            }

            self.triton.cloudapi.waitForMachineStates({
                id: uuid,
                states: [state]
            }, function (err, machine) {
                if (err) {
                    callback(err);
                    return;
                }
                var dur = common.humanDurationFromMs(Date.now() - now);
                if (alias)
                    console.log('%s instance %s (%s, %s)', common.capitalize(action), alias, uuid, dur);
                else
                    console.log('%s instance %s (%s)', common.capitalize(action), uuid, dur);
                callback();
            });
        });
    }
}

module.exports = do_startstop_instance;
