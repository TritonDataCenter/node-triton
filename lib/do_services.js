/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton services ...`
 */

var tabula = require('tabula');

var common = require('./common');

function do_services(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var columns = (opts.o || 'name,endpoint').split(',');
    var sort = (opts.s || 'name').split(',');

    this.triton.cloudapi.listServices(function (err, services) {
        if (err) {
            callback(err);
            return;
        }

        /*
         * services are returned in the form of:
         * {name: 'endpoint', name2: 'endpoint2', ...}
         * we "normalize" them for use by tabula and JSON stream
         * by making them an array
         */

        var svcs = [];
        Object.keys(services).forEach(function (key) {
            svcs.push({
                name: key,
                endpoint: services[key]
            });
        });

        if (opts.json) {
            common.jsonStream(svcs);
        } else {
            tabula(svcs, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                dottedLookup: true
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
    }
].concat(common.TABULA_OPTIONS);

do_services.help = (
    'Show services information\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} services\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_services;
