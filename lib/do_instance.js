/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton instance ...`
 */

var common = require('./common');

function do_instance(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var id = args[0];

    if (common.isUUID(id)) {
        this.triton.cloudapi.getMachine(id, cb);
    } else {
        this.triton.getMachineByAlias(id, cb);
    }

    function cb(err, machine) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(machine));
        } else {
            console.log(JSON.stringify(machine, null, 4));
        }
        callback();
    }
}

do_instance.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];
do_instance.help = (
    'Show a single instance.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} instance <alias|id>\n'
    + '\n'
    + '{{options}}'
);

do_instance.aliases = ['inst'];

module.exports = do_instance;
