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

function do_cloudapi(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1 || args.length > 2) {
        callback(new Error('invalid arguments'));
        return;
    }

    var method = args[0];
    var path = args[1];
    if (path === undefined) {
        path = method;
        method = 'GET';
    }

    var reqopts = {
        method: method.toLowerCase(),
        path: path
    };

    this.tritonapi.cloudapi._request(reqopts, function (err, req, res, body) {
        if (err) {
            callback(err);
            return;
        }
        if (opts.headers || reqopts.method === 'head') {
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

        if (reqopts.method !== 'head')
            console.log(JSON.stringify(body, null, 4));
        callback();
    });
}

do_cloudapi.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['headers', 'i'],
        type: 'bool',
        help: 'Print response headers to stderr.'
    }
];
do_cloudapi.help = (
    'Raw cloudapi request.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} <method> <endpoint>\n'
    + '\n'
    + '{{options}}'
);

do_cloudapi.hidden = true;


module.exports = do_cloudapi;
