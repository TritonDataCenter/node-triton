/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance nic list ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../../common');
var errors = require('../../errors');


var VALID_FILTERS = ['ip', 'mac', 'state', 'default', 'network', 'gateway'];
var COLUMNS_DEFAULT = 'ip,mac,state,default,network';
var COLUMNS_DEFAULT_LONG = 'ip,mac,state,default,network,gateway';
var SORT_DEFAULT = 'ip';


function do_list(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 1) {
        cb(new errors.UsageError('missing INST argument'));
        return;
    }

    var inst = args.shift();

    try {
        var filters = common.objFromKeyValueArgs(args, {
            validKeys: VALID_FILTERS,
            disableDotted: true
        });
    } catch (e) {
        cb(e);
        return;
    }

    if (filters.default !== undefined) {
        filters.default =
            common.boolFromString(filters.default, null, 'default');
    }

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.listNics({id: inst}, function onNics(err, nics) {
            if (err) {
                cb(err);
                return;
            }

            // do filtering
            Object.keys(filters).forEach(function (key) {
                var val = filters[key];
                nics = nics.filter(function (nic) {
                    // default is a boolean, but can be absent, and we want to
                    // treat undefined as false
                    if (key === 'default')
                        nic.default = !!nic.default;

                    return nic[key] === val;
                });
            });

            if (opts.json) {
                common.jsonStream(nics);
            } else {
                nics.forEach(function (nic) {
                    nic.network = nic.network.split('-')[0];
                    nic.ip = nic.ip + '/' + convertCidrSuffix(nic.netmask);
                });

                var columns = COLUMNS_DEFAULT;

                if (opts.o) {
                    columns = opts.o;
                } else if (opts.long) {
                    columns = COLUMNS_DEFAULT_LONG;
                }

                columns = columns.split(',');
                var sort = opts.s.split(',');

                tabula(nics, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort
                });
            }

            cb();
        });
    });
}


function convertCidrSuffix(netmask) {
    var bitmask = netmask.split('.').map(function (octet) {
        return (+octet).toString(2);
    }).join('');

    var i = 0;
    for (i = 0; i < bitmask.length; i++) {
        if (bitmask[i] === '0')
            break;
    }

    return i;
}


do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: SORT_DEFAULT
}));

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] [FILTERS]'];

do_list.help = [
    'Show all NICs on an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Where INST is an instance id (full UUID), name, or short id.',
    '',
    'Filters:',
    '    FIELD=<boolean>   Boolean filter. Supported fields: default',
    '    FIELD=<string>    String filter. Supported fields: ip, mac, state,',
    '                      network, netmask',
    '',
    'Filters are applied client-side (i.e. done by the triton command itself).'
].join('\n');

do_list.completionArgtypes = ['tritoninstance', 'none'];

do_list.aliases = ['ls'];

module.exports = do_list;
