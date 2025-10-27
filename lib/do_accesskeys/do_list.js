/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys list ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');


var COLUMNS_DEFAULT = 'accesskeyid,status,updated';
var COLUMNS_LONG = 'accesskeyid,status,description,created,updated';
var SORT_DEFAULT = 'created';


function do_list(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length > 0) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(err) {
        if (err) {
            cb(err);
            return;
        }

        tritonapi.cloudapi.listAccessKeys({}, function onList(listErr, keys) {
            if (listErr) {
                cb(listErr);
                return;
            }

            keys = keys || [];

            if (opts.json) {
                common.jsonStream(keys);
            } else {
                var columns = opts.long ? COLUMNS_LONG : COLUMNS_DEFAULT;
                if (opts.o) {
                    columns = opts.o.toLowerCase();
                }
                columns = columns.split(',');

                var sort = SORT_DEFAULT;
                if (opts.s) {
                    sort = opts.s.toLowerCase();
                }
                var sort = sort.split(',');

                tabula(keys, {
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
    includeLong: true,
    sortDefault: SORT_DEFAULT
}));

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_list.help = [
    'List CloudAPI access keys.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
