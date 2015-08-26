/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton services ...`
 */

var common = require('./common');

function do_services(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    this.triton.cloudapi.listServices(function (err, services) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(services));
        } else {
            // pretty print
            Object.keys(services).forEach(function (key) {
                var val = services[key];
                console.log('%s: %s', key, val);
            });
        }
        callback();
    });
}

do_services.options = [
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
do_services.help = (
    'Show services information\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} services\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_services;
