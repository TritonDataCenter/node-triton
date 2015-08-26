/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton network ...`
 */

var common = require('./common');

function do_network(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        cb(new Error('invalid args: ' + args));
        return;
    }

    var id = args[0];

    if (common.isUUID(id)) {
        this.triton.cloudapi.getNetwork(id, done);
    } else {
        // we have to list all networks and find the one pertaining
        // to the alias given
        this.triton.cloudapi.listNetworks(function (err, networks) {
            if (err) {
                done(err);
                return;
            }

            var net;
            // try to find the network
            networks.forEach(function (network) {
                if (network.name === id)
                    net = network;
            });

            if (net) {
                // found!
                done(null, net);
            } else {
                // not found
                done(new Error('network ' + id + ' not found'));
            }
        });
    }

    function done(err, network) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(network));
        } else {
            console.log(JSON.stringify(network, null, 4));
        }
        cb();
    }
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
