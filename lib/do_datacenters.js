/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton datacenters ...`
 */

var tabula = require('tabula');

var common = require('./common');

// columns default without -o
var columnsDefault = 'name,url';

// sort default with -s
var sortDefault = 'name';

function do_datacenters(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var columns = opts.o.split(',');
    var sort = opts.s.split(',');

    this.triton.cloudapi.listDatacenters(function (err, datacenters) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(datacenters));
        } else {
            /*
             * datacenters are returned in the form of:
             * {name: 'url', name2: 'url2', ...}
             * we "normalize" them for use by tabula by making them an array
             */
            var dcs = [];
            Object.keys(datacenters).forEach(function (key) {
                dcs.push({
                    name: key,
                    url: datacenters[key]
                });
            });
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
].concat(common.getCliTableOptions({
    columnsDefault: columnsDefault,
    sortDefault: sortDefault
}));

do_datacenters.help = (
    'Show datacenters information\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} datacenters\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_datacenters;
