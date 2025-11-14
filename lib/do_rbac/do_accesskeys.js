/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton rbac accesskeys ...`
 */

var tabula = require('tabula');
var assert = require('assert-plus');

var common = require('../common');
var errors = require('../errors');

var COLUMNS_DEFAULT = 'accesskeyid,status,updated';
var COLUMNS_LONG = 'accesskeyid,status,description,created,updated';
var SORT_DEFAULT = 'created';

function do_accesskeys(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length === 0) {
        cb(new errors.UsageError('no USER argument given'));
        return;
    } else if (args.length !== 1) {
        cb(new errors.UsageError('invalid args: ' + args));
        return;
    }

    assert.func(cb, 'cb');

    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(err) {
        if (err) {
            cb(err);
            return;
        }

        tritonapi.cloudapi.listUserAccessKeys({userId: args[0]},
            function onList(listErr, keys) {
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
                sort = sort.split(',');

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

do_accesskeys.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: SORT_DEFAULT
}));

do_accesskeys.synopses = ['{{name}} {{cmd}} [OPTIONS] USER'];

do_accesskeys.help = [
    /* BEGIN JSSTYLED */
    'List RBAC user access keys.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "USER" is an RBAC user login or id (a UUID).'
    /* END JSSTYLED */
].join('\n');

module.exports = do_accesskeys;
