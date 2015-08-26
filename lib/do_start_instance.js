/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton start-instance ...`
 */

var common = require('./common');

function do_start_instance(subcmd, opts, args, callback) {
    var self = this;
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
        self.triton.cloudapi.startMachine(uuid, function (err, body, res) {
            if (err) {
                callback(err);
                return;
            }
            callback();
        });

    }
}

do_start_instance.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
];
do_start_instance.help = (
    'Stop a single instance.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} start <alias|id>\n'
    + '\n'
    + '{{options}}'
);

do_start_instance.aliases = ['start'];

module.exports = do_start_instance;
