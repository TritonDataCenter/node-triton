/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton vlan list ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');


var COLUMNS_DEFAULT = 'vlan_id,name,description';
var SORT_DEFAULT = 'vlan_id';
var VALID_FILTERS = ['vlan_id', 'name', 'description'];


function do_list(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    try {
        var filters = common.objFromKeyValueArgs(args, {
            validKeys: VALID_FILTERS,
            disableDotted: true
        });
    } catch (e) {
        cb(e);
        return;
    }

    if (filters.vlan_id !== undefined)
        filters.vlan_id = +filters.vlan_id;

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        var cloudapi = cli.tritonapi.cloudapi;
        cloudapi.listFabricVlans({}, function onList(err, vlans) {
            if (err) {
                cb(err);
                return;
            }

            // do filtering
            Object.keys(filters).forEach(function (key) {
                var val = filters[key];
                vlans = vlans.filter(function (vlan) {
                    return vlan[key] === val;
                });
            });

            if (opts.json) {
                common.jsonStream(vlans);
            } else {
                var columns = COLUMNS_DEFAULT;

                if (opts.o) {
                    columns = opts.o;
                }

                columns = columns.split(',');
                var sort = opts.s.split(',');

                tabula(vlans, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort
                });
            }
            cb();
        });
    });
}


do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    sortDefault: SORT_DEFAULT
}));

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] [FILTERS]'];

do_list.help = [
    'List VLANs.',
    '',
    '{{usage}}',
    '',
    'Filters:',
    '    FIELD=<integer>   Number filter. Supported fields: vlan_id',
    '    FIELD=<string>    String filter. Supported fields: name, description',
    '',
    '{{options}}',
    'Filters are applied client-side (i.e. done by the triton command itself).'
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
