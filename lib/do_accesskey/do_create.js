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
var fs = require('fs');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');

var COLUMNS_DEFAULT = 'accesskeyid,accesskeysecret';
var COLUMNS_LONG = 'accesskeyid,status,credentialtype,description,created,updated,expiration,scope';

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

    if (opts.scope) {
        var raw = opts.scope;
        if (raw[0] === '@') {
            try {
                raw = fs.readFileSync(raw.slice(1), 'utf8');
            } catch (e) {
                cb(new errors.UsageError(
                    'cannot read --scope file: ' + e.message));
                return;
            }
        }
        try {
            params.scope = JSON.parse(raw);
        } catch (e) {
            cb(new errors.UsageError(
                '--scope is not valid JSON: ' + e.message));
            return;
        }
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(err) {
        if (err) {
            cb(err);
            return;
        }

        tritonapi.cloudapi.createAccessKey(params, function onCreate(err2,
            accessKey) {
            if (err2) {
                cb(err2);
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

                // If -o was provided only display requested columns, else
                // if status or description were provided display those as well.
                if (!opts.o) {
                    if (opts.status) {
                        columns.push('status');
                    }

                    if (opts.description) {
                        columns.push('description');
                    }

                    if (opts.scope) {
                        columns.push('scope');
                    }
                }

                if (accessKey.scope &&
                  typeof (accessKey.scope) === 'object') {
                    accessKey.scope = JSON.stringify(accessKey.scope);
                }

                tabula([accessKey], {
                    skipHeader: opts.H,
                    columns: columns
                });
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
        names: ['scope'],
        type: 'string',
        helpArg: 'JSON|@FILE',
        help: 'Per-bucket scope envelope as JSON, or "@path" to read from ' +
              'a file. Example:\n' +
              '  --scope=\'{"version":1,"permissions":' +
              '[{"bucket":"logs-*","level":"read"}]}\'\n' +
              'Omit for an unrestricted key.'
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

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_create.help = [
    'Create a new access key.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_create;
