/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton metadata list ...`
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
        }
        cli.tritonapi.listInstanceMetadatas({
            id: machineId
        }, function onMetadatas(err, metadatas) {
            if (err) {
                cb(err);
                return;
            }
            if (opts.json) {
                 console.log(JSON.stringify(metadatas));
            } else {
                 console.log(JSON.stringify(metadatas, 4, null));
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
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];

do_list.help = [
    'Show all of an instance\'s metadatas.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id, name, or shortid.',
    '',
    'Note: Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'

].join('\n');

do_list.completionArgtypes = ['tritoninstance', 'none'];

do_list.aliases = ['ls'];

module.exports = do_list;
