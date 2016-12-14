/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton cloudapi ...`
 */

var http = require('http');
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');


function do_cloudapi(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1) {
        callback(new Error('invalid arguments'));
        return;
    }

    // Get `reqOpts` from given options.
    var method = opts.method;
    if (!method) {
        if (opts.data) {
            method = 'PUT';
        } else {
            method = 'GET';
        }
    }
    var reqOpts = {
        method: method.toLowerCase(),
        headers: {},
        path: args[0]
    };
    if (opts.header) {
        for (var i = 0; i < opts.header.length; i++) {
            var raw = opts.header[i];
            var j = raw.indexOf(':');
            if (j < 0) {
                callback(new errors.TritonError(
                    'failed to parse header: ' + raw));
                return;
            }
            var header = raw.substr(0, j);
            var value = raw.substr(j + 1).trimLeft();
            reqOpts.headers[header] = value;
        }
    }
    if (opts.data) {
        try {
            reqOpts.data = JSON.parse(opts.data);
        } catch (parseErr) {
            callback(new errors.TritonError(parseErr,
                'given DATA is not valid JSON: ' + parseErr.message));
            return;
        }
    }

    vasync.pipeline({arg: {cli: this}, funcs: [
        common.cliSetupTritonApi,

        function callCloudapi(ctx, next) {
            var cloudapi = ctx.cli.tritonapi.cloudapi;
            cloudapi._request(reqOpts, function (err, req, res, body) {
                if (err) {
                    next(err);
                    return;
                }
                if (opts.headers || reqOpts.method === 'head') {
                    console.error('%s/%s %d %s',
                        req.connection.encrypted ? 'HTTPS' : 'HTTP',
                        res.httpVersion,
                        res.statusCode,
                        http.STATUS_CODES[res.statusCode]);
                    Object.keys(res.headers).forEach(function (key) {
                        console.error('%s: %s', key, res.headers[key]);
                    });
                    console.error();
                }

                if (reqOpts.method !== 'head')
                    console.log(JSON.stringify(body, null, 4));
                next();
            });
        }
    ]}, callback);
}

do_cloudapi.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['method', 'X'],
        type: 'string',
        helpArg: 'METHOD',
        help: 'Request method to use. Default is "GET".'
    },
    {
        names: ['header', 'H'],
        type: 'arrayOfString',
        helpArg: 'HEADER',
        help: 'Headers to send with request.'
    },
    {
        names: ['headers', 'i'],
        type: 'bool',
        help: 'Print response headers to stderr.'
    },
    {
        names: ['data', 'd'],
        type: 'string',
        helpArg: 'DATA',
        help: 'Add POST data. This must be valid JSON.'
    }
];

do_cloudapi.synopses = [
    '{{name}} {{cmd}} [-X METHOD] [-H HEADER=VAL] [-d DATA] ENDPOINT'
];

do_cloudapi.help = [
    'Raw cloudapi request.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Examples:',
    '    {{name}} {{cmd}} /--ping',
    '    {{name}} {{cmd}} /my/machines'
].join('\n');

do_cloudapi.hidden = true;


module.exports = do_cloudapi;
