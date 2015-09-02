/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton network ...`
 */

var format = require('util').format;

var common = require('./common');
var errors = require('./errors');


function do_network(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        return cb(new errors.UsageError(format(
            'incorrect number of args (%d): %s', args.length, args.join(' '))));
    }

    this.triton.getNetwork(args[0], function (err, net) {
        if (err) {
            return cb(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(net));
        } else {
            console.log(JSON.stringify(net, null, 4));
        }
        cb();
    });
}

do_network.options = [
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
do_network.help = (
    'Show a network.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} network <id>\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_network;
