/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton datacenters ...`
 */

var tabula = require('tabula');

var common = require('./common');

function do_datacenters(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var columns = (opts.o || 'name,url').split(',');
    var sort = (opts.s || 'name').split(',');

    this.triton.cloudapi.listDatacenters(function (err, datacenters) {
        if (err) {
            callback(err);
            return;
        }

        /*
         * datacenters are returned in the form of:
         * {name: 'url', name2: 'url2', ...}
         * we "normalize" them for use by tabula and JSON stream
         * by making them an array
         */
        var dcs = [];
        Object.keys(datacenters).forEach(function (key) {
            dcs.push({
                name: key,
                url: datacenters[key]
            });
        });

        if (opts.json) {
            common.jsonStream(dcs);
        } else {
            tabula(dcs, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                dottedLookup: true
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
    }
].concat(common.TABULA_OPTIONS);
do_datacenters.help = (
    'Show datacenters information\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} datacenters\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_datacenters;
