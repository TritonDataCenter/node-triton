/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton migration list ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../../common');
var errors = require('../../errors');


var COLUMNS_DEFAULT = 'shortid,phase,state,age';
var COLUMNS_DEFAULT_LONG = 'machine,phase,state,created_timestamp';
var SORT_DEFAULT = 'created_timestamp';


function do_list(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.listMigrations({
        }, function onMigrations(err, migrations) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                common.jsonStream(migrations);
                cb();
                return;
            }

            var columns = COLUMNS_DEFAULT;

            if (opts.o) {
                columns = opts.o;
            } else if (opts.long) {
                columns = COLUMNS_DEFAULT_LONG;
            }

            var now = new Date();
            migrations = migrations.map(function fmtMigr(migr) {
                migr.shortid = migr.machine.split('-', 1)[0];
                var created = new Date(migr.created_timestamp);
                migr.age = common.longAgo(created, now);
                return migr;
            });

            columns = columns.split(',');
            var sort = opts.s.split(',');

            tabula(migrations, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
            });
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

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_list.help = [
    'Show all of an account\'s migrations.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_list.completionArgtypes = ['tritoninstance', 'none'];

do_list.aliases = ['ls'];

module.exports = do_list;
