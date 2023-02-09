/*
 * Copyright 2012 Mark Cavage, Inc.  All rights reserved.
 * Copyright (c) 2015, Joyent, Inc.
 * Copyright 2023 MNX Cloud, Inc.
 */

/*
 * TODO: this should be a separate module. Both node-triton and
 * node-docker-registry-client are using (slightly different versions of) this.
 *
 * Adapted from
 * <github.com/mcavage/node-restify/blob/master/lib/clients/string_client.js>
 * now at <https://github.com/restify/clients/blob/master/lib/StringClient.js>
 *
 * This subclasses the Restify StringClient to add the following features:
 *
 * 1. Extend the callback from
 *      callback(err, req, res, <JSON-parsed-body>);
 *    to:
 *      callback(err, req, res, <JSON-parsed-body>, <raw-body (Buffer)>);
 *    This allows one to work on the raw body for special case handling, if
 *    wanted. I'm not sure I'd propose this for restify core because it
 *    shouldn't add features that make it harder to go all streaming.
 *
 * 2. In restify.JsonClient, if the body is not parseable JSON, it log.trace's
 *    an error, and returns `{}` (see mcavage/restify#388). I don't particularly
 *    like that because it is ambiguous (and also disallows returning a JSON
 *    body that is false-y: `false`, `0`, `null`).
 *
 *    Instead this client will do the following:
 *    (a) If the response is an error status (>=400), then return `undefined`
 *        for the body. This allows the caller to know if the body was parsed
 *        because `undefined` is not representable in JSON.
 *    (b) If the response is a success (<400), then return an
 *        InvalidContentError restify error.
 *
 *    (TODO: I'd support this for restify code, but it *is* backward
 *    incompatible.)
 *
 * 3. `.write()` doesn't default a null `body` to `{}`.
 *    This change isn't because I came across the need for it, but because that
 *    just seems wrong.
 *
 * 4. Doesn't set `res.body` which restify's StringClient.parse seems to do
 *    ... as an accident of history I'm guessing?
 */

/* jsl:ignore */
'use strict';
/* jsl:end */

var assert = require('assert-plus');
var crypto = require('crypto');
var strsplit = require('strsplit').strsplit;
var util = require('util');
var zlib = require('zlib');

var errors = require('restify-errors');
var codeToHttpError = errors.codeToHttpError;
var RestError = errors.RestError;
var StringClient = require('restify-clients').StringClient;


// --- API

function SaferJsonClient(options) {
    assert.object(options, 'options');

    options.accept = 'application/json';
    options.name = options.name || 'SaferJsonClient';
    options.contentType = 'application/json';

    StringClient.call(this, options);

    this._super = StringClient.prototype;
}
util.inherits(SaferJsonClient, StringClient);


SaferJsonClient.prototype.write = function write(options, body, callback) {
    assert.object(body, 'body');

    // This is change #3.
    var resBody = JSON.stringify(body);
    return (this._super.write.call(this, options, resBody, callback));
};


SaferJsonClient.prototype.parse = function parse(req, callback) {
    function parseResponse(err, res) {
        var chunks = []; // gunzipped response chunks (Buffer objects)
        var len = 0; // accumulated count of chunk lengths
        var contentMd5;
        var contentMd5Hash;
        var gz;
        var resErr = err;

        function finish() {
            var body = Buffer.concat(chunks, len);

            /*
             * Save the original response's body in case this is the best error
             * message we can output to the user. The responsibility to use this
             * property is left to the user of this custom JSON client.
             *
             * See lib/cli.js and TritonDataCenter/node-triton#30 for a concrete
             * use case.
             */
            if (resErr) {
                resErr.originalBody = body;
            }

            if (res.log.trace()) {
                res.log.trace({body: body.toString(), len: len},
                    'body received');
            }

            // Content-Length check
            var contentLength = Number(res.headers['content-length']);
            if (req.method !== 'HEAD' &&
                !isNaN(contentLength) && len !== contentLength)
            {
                resErr = new errors.InvalidContentError(util.format(
                    'Incomplete content: Content-Length:%s but got %s bytes',
                    contentLength, len));
                callback(resErr, req, res);
                return;
            }

            // Content-MD5 check.
            if (contentMd5Hash &&
                contentMd5 !== contentMd5Hash.digest('base64'))
            {
                resErr = new errors.BadDigestError('Content-MD5');
                callback(resErr, req, res);
                return;
            }

            // Parse the body as JSON, if we can.
            // Note: This regex-based trim works on a buffer. `trim()` doesn't.
            var obj;
            if (len && !/^\s*$/.test(body)) {  // Skip all-whitespace body.
                try {
                    obj = JSON.parse(body);
                } catch (jsonErr) {
                    res.log.trace(jsonErr, 'Invalid JSON in response');
                    if (!resErr) {
                        // TODO: Does this mask other error statuses?
                        resErr = new errors.InvalidContentError(
                            'Invalid JSON in response');
                    }
                }
            }

            // Special error handling.
            if (res && res.statusCode >= 400) {
                // Upcast error to a RestError (if we can)
                // Be nice and handle errors like
                // { error: { code: '', message: '' } }
                // in addition to { code: '', message: '' }.
                if (obj && (obj.code || (obj.error && obj.error.code))) {
                    var _c = obj.code ||
                        (obj.error ? obj.error.code : '') ||
                        '';
                    var _m = obj.message ||
                        (obj.error ? obj.error.message : '') ||
                        '';

                    resErr = new RestError({
                        message: _m,
                        restCode: _c,
                        statusCode: res.statusCode
                    });
                    resErr.name = resErr.restCode;

                    if (!/Error$/.test(resErr.name)) {
                        resErr.name += 'Error';
                    }
                } else if (!resErr) {
                    resErr = codeToHttpError(res.statusCode,
                        obj.message || '', body);
                }
            }
            if (resErr) {
                resErr.body = obj;
            }

            callback(resErr, req, res, obj, body);
        }


        if (!res) {
            // Early out if we didn't even get a response.
            callback(resErr, req);
            return;
        }

        // Content-MD5 setup.
        contentMd5 = res.headers['content-md5'];
        if (contentMd5 && req.method !== 'HEAD' && res.statusCode !== 206) {
            contentMd5Hash = crypto.createHash('md5');
        }

        if (res.headers['content-encoding'] === 'gzip') {
            gz = zlib.createGunzip();
            gz.on('data', function (chunk) {
                chunks.push(chunk);
                len += chunk.length;
            });
            gz.once('end', finish);
            res.once('end', gz.end.bind(gz));
        } else {
            res.once('end', finish);
        }

        res.on('data', function onData(chunk) {
            if (contentMd5Hash) {
                contentMd5Hash.update(chunk.toString('utf8'));
            }

            if (gz) {
                gz.write(chunk);
            } else {
                chunks.push(chunk);
                len += chunk.length;
            }
        });
    }

    return (parseResponse);
};



// --- Exports

module.exports = SaferJsonClient;
