/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton vpc list ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');


var COLUMNS_DEFAULT = 'vpc_id,name,description';
var SORT_DEFAULT = 'vpc_id';
var VALID_FILTERS = ['vpc_id', 'name', 'description'];


function do_list(subcmd, opts, args, cb) {
    assert.object(opts, 'opts');
    assert.array(args, 'args');
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

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        var cloudapi = cli.tritonapi.cloudapi;
        cloudapi.listVPCs({}, function onList(err, vpcs) {
            if (err) {
                cb(err);
                return;
            }

            // do filtering
            Object.keys(filters).forEach(function doFilter(key) {
                var val = filters[key];
                vpcs = vpcs.filter(function eachVPC(vpc) {
                    return vpc[key] === val;
                });
            });

            if (opts.json) {
                common.jsonStream(vpcs);
            } else {
                var columns = COLUMNS_DEFAULT;

                if (opts.o) {
                    columns = opts.o;
                }

                columns = columns.split(',');
                var sort = opts.s.split(',');

                tabula(vpcs, {
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
    'List VPCs.',
    '',
    '{{usage}}',
    '',
    'Filters:',
    '    FIELD=<uuid>      UUID filter. Supported fields: vpc_id',
    '    FIELD=<string>    String filter. Supported fields: name, description',
    '',
    '{{options}}',
    'Filters are applied client-side (i.e. done by the triton command itself).'
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
