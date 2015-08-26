/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton datacenters ...`
 */

var common = require('./common');

function do_datacenters(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    this.triton.cloudapi.listDatacenters(function (err, datacenters) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(datacenters));
        } else {
            // pretty print
            Object.keys(datacenters).forEach(function (key) {
                var val = datacenters[key];
                console.log('%s: %s', key, val);
            });
        }
        callback();
    });
}

do_datacenters.options = [
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
do_datacenters.help = (
    'Show datacenters information\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} datacenters\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_datacenters;
