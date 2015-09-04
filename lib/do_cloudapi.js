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
    } else if (args.length < 1) {
        callback(new Error('invalid arguments'));
        return;
    }

    var path = args[0];

    var reqopts = {
        method: opts.method.toLowerCase(),
        headers: {},
        path: path
    };

    // parse -H headers
    for (var i = 0; i < opts.header.length; i++) {
        var raw = opts.header[i];
        var j = raw.indexOf(':');
        if (j < 0) {
            callback(new Error('failed to parse header: ' + raw));
            return;
        }
        var header = raw.substr(0, j);
        var value = raw.substr(j + 1).leftTrim();

        reqopts.headers[header] = value;
    }

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
        names: ['method', 'X'],
        type: 'string',
        default: 'GET',
        help: 'Request method to use. Default is "GET".'
    },
    {
        names: ['header', 'H'],
        type: 'arrayOfString',
        default: [],
        help: 'Headers to send with request.'
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
    + '     {{name}} [-X method] [-H header=value] <endpoint>\n'
    + '\n'
    + '{{options}}'
);

do_cloudapi.hidden = true;


module.exports = do_cloudapi;
