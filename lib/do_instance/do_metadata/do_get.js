/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton metadata get ...`
 */

var assert = require('assert-plus');

var common = require('../../common');
var errors = require('../../errors');


function do_get(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and/or METANAME arguments'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];
    var name = args[1];
    var cli = this.top;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        cli.tritonapi.getInstanceMetadata({
            id: id,
            name: name
        }, function onMetadata(err, metadata) {
            if (err) {
                cb(err);
                return;
            }
            if (opts.json) {
                console.log(JSON.stringify(metadata));
            } else {
                console.log(metadata);
            }
            cb();
        });
    });
}

do_get.options = [
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

do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] INST NAME'];

do_get.help = [
    'Get an instance metadata.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'where INST is an instance id, name, or shortid and NAME is a meta name.'
].join('\n');

do_get.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_get;
