/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disk list ...`
 */
var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../../common');
var errors = require('../../errors');

var COLUMNS_DEFAULT = 'shortid,size,pci_slot';
var COLUMNS_DEFAULT_LONG = 'id,size,pci_slot,boot';
var SORT_DEFAULT = 'pci_slot,shortid';

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
    var instanceId = args[0];

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }
        cli.tritonapi.listInstanceDisks({
            id: instanceId
        }, function onDisks(err, disks) {
            if (err) {
                cb(err);
                return;
            }

            disks.forEach(function (disk) {
                disk.shortid = disk.id.split('-', 1)[0];
                delete disk.state;
            });

            if (opts.json) {
                common.jsonStream(disks);
            } else {
                var columns = COLUMNS_DEFAULT;

                if (opts.o) {
                    columns = opts.o;
                } else if (opts.long) {
                    columns = COLUMNS_DEFAULT_LONG;
                }

                columns = columns.split(',');
                var sort = opts.s.split(',');

                tabula(disks, {
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
    'Show the disks that belong to an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');

do_list.completionArgtypes = ['tritoninstance', 'none'];

do_list.aliases = ['ls'];

module.exports = do_list;
