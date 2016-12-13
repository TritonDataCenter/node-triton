/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton services ...`
 */

var tabula = require('tabula');

var common = require('./common');

// columns default without -o
var columnsDefault = 'name,endpoint';

// sort default with -s
var sortDefault = 'name';

function do_services(subcmd, opts, args, callback) {
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
        tritonapi.cloudapi.listServices(function (err, services) {
            if (err) {
                callback(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(services));
            } else {
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
                tabula(svcs, {
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

do_services.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    columnsDefault: columnsDefault,
    sortDefault: sortDefault
}));

do_services.synopses = ['{{name}} {{cmd}}'];

do_services.help = [
    'Show services information',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_services;
