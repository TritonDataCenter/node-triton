/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton stop-instance ...`
 */

var common = require('./common');

function do_stop_instance(subcmd, opts, args, callback) {
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
        self.triton.cloudapi.stopMachine(uuid, function (err, body, res) {
            if (err) {
                callback(err);
                return;
            }
            callback();
        });

    }
}

do_stop_instance.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
];
do_stop_instance.help = (
    'Stop a single instance.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} stop <alias|id>\n'
    + '\n'
    + '{{options}}'
);

do_stop_instance.aliases = ['stop'];

module.exports = do_stop_instance;
