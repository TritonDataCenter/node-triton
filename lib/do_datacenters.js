/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
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
    var tritonapi = this.tritonapi;

    common.cliSetupTritonApi({cli: this}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        tritonapi.cloudapi.listDatacenters(function (err, datacenters) {
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

do_datacenters.synopses = ['{{name}} {{cmd}}'];

do_datacenters.help = [
    'Show datacenters in this cloud.',
    'A "cloud" is a set of related datacenters that share account',
    'information.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_datacenters;
