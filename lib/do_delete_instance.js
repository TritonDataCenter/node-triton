/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton delete ...`
 */

var common = require('./common');

function do_delete_instance(subcmd, opts, args, callback) {
    var self = this;

    var now = Date.now();

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var arg = args[0];
    var uuid;

    if (common.isUUID(arg)) {
        uuid = arg;
        go1();
    } else {
        self.triton.getMachineByAlias(arg, function (err, machine) {
            if (err) {
                callback(err);
                return;
            }
            uuid = machine.id;
            go1();
        });
    }

    function go1() {
        // called when "uuid" is set
        self.triton.cloudapi.deleteMachine(uuid, function (err, body, res) {
            if (err) {
                callback(err);
                return;
            }

            if (!opts.wait) {
                console.log('Deleted (async) instance %s (id %s, %s)',
                    arg, uuid, common.humanDurationFromMs(Date.now() - now));
                callback();
                return;
            }

            self.triton.cloudapi.waitForMachineStates({
                id: uuid,
                states: ['deleted']
            }, function (err, machine, res) {
                if (res && res.statusCode === 410) {
                    // gone... success!
                    console.log('Deleted instance %s (id %s, %s)',
                        arg, uuid, common.humanDurationFromMs(Date.now() - now));
                    callback();
                    return;
                } else if (err) {
                    callback(err);
                    return;
                }
                callback(new Error('unknown state'));
            });
        });
    }
}

do_delete_instance.aliases = ['delete'];

do_delete_instance.help = [
    'delete a single instance.',
    '',
    'Usage:',
    '       {{name}} delete <alias|id>',
    '',
    '{{options}}'
];
do_delete_instance.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for machine to be deleted.'
    }
];


module.exports = do_delete_instance;
