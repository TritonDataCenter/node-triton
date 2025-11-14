/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys get ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');

var COLUMNS_DEFAULT = 'accesskeyid,status,updated';
var COLUMNS_LONG = 'accesskeyid,status,description,created,updated';

function do_get(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing ACCESSKEYID argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var accessKeyId = args[0];
    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        tritonapi.cloudapi.getAccessKey({
            accessKeyId: accessKeyId
        }, function onGet(err, accessKey) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(accessKey));
            } else {
                var columns = opts.long ? COLUMNS_LONG : COLUMNS_DEFAULT;
                if (opts.o) {
                    columns = opts.o.toLowerCase();
                }
                columns = columns.split(',');

                tabula([accessKey], {
                    skipHeader: opts.H,
                    columns: columns
                });
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
    },
    {
        names: ['long', 'l'],
        type: 'bool',
        help: 'Long/wider output. Ignored if "-o ..." is used.'
    },
    {
        names: ['o'],
        type: 'string',
        help: 'Specify fields (columns) to output.',
        helpArg: 'field1,...'
    },
    {
        names: ['H'],
        type: 'bool',
        help: 'Omit table header row.'
    }
];

do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] ACCESSKEYID'];

do_get.help = [
    'Show details for a specific access key.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_get;
