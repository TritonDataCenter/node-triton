/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys create`
 */

var assert = require('assert-plus');
var common = require('../common');
var errors = require('../errors');


function do_create(subcmd, opts, args, cb) {
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

    var params = {};

    if (opts.status) {
        params.status = opts.status;
    }

    if (opts.description) {
        params.description = opts.description;
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(err) {
        if (err) {
            cb(err);
            return;
        }

        tritonapi.cloudapi.createAccessKey(params, function onCreate(err2,
            accesskey) {
            if (err2) {
                cb(err2);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(accesskey));
            } else {
                console.log('Created access key %s', accesskey.accesskeyid);
                console.log('Secret: %s', accesskey.accesskeysecret);
            }

            cb();
        });
    });
}


do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['description', 'desc', 'd'],
        type: 'string',
        helpArg: 'DESC',
        help: 'A short description for the access key.'
    },
    {
        names: ['status', 's'],
        type: 'string',
        helpArg: 'STATUS',
        help: 'Status for the access key'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_create.help = [
    'Create a new CloudAPI access key.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_create;
