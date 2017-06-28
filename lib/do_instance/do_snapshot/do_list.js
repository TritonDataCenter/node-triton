/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton snapshot list ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../../common');
var errors = require('../../errors');


var COLUMNS_DEFAULT = 'name,state,created';
var SORT_DEFAULT = 'name';


function do_list(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing INST argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;
    var machineId = args[0];

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }
        cli.tritonapi.listInstanceSnapshots({
            id: machineId
        }, function onSnapshots(err, snapshots) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                common.jsonStream(snapshots);
            } else {
                var columns = COLUMNS_DEFAULT;

                if (opts.o) {
                    columns = opts.o;
                } else if (opts.long) {
                    columns = COLUMNS_DEFAULT;
                }

                columns = columns.split(',');
                var sort = opts.s.split(',');

                tabula(snapshots, {
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

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_list.help = [
    'Show all of an instance\'s snapshots.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_list.completionArgtypes = ['tritoninstance', 'none'];

do_list.aliases = ['ls'];

module.exports = do_list;
