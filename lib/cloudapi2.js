/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Client library for the SmartDataCenter Cloud API (cloudapi).
 * http://apidocs.joyent.com/cloudapi/
 *
 * Usage example::
 *
 *      var auth = require('smartdc-auth');
 *      var cloudapi = require('./lib/cloudapi2');
 *      var client = cloudapi.createClient({
 *              url: <URL>,                 // 'https://us-sw-1.api.joyentcloud.com',
 *              user: <USER>,               // 'bob'
 *              log: <BUNYAN-LOGGER>,
 *              sign: auth.cliSigner({
 *                  keyId: <KEY-ID>,        // ssh fingerprint
 *                  user: <USER>,           // 'bob'
 *                  log: <BUNYAN-LOGGER>,
 *              }),
 *              ...
 *      });
 *      client.listImages(function (err, images) { ... });
 *      ...
 *
 */

var p = console.log;

var assert = require('assert-plus');
var async = require('async');
var auth = require('smartdc-auth');
var os = require('os');
var querystring = require('querystring');
var restify = require('restify');
var sprintf = require('util').format;

var errors = require('./errors');



// ---- globals

var SDC_VERSION = require('../package.json').version;
var OS_ARCH = os.arch();
var OS_PLATFORM = os.platform();



// ---- internal support stuff

// A no-op bunyan logger shim.
function BunyanNoopLogger() {}
BunyanNoopLogger.prototype.trace = function () {};
BunyanNoopLogger.prototype.debug = function () {};
BunyanNoopLogger.prototype.info = function () {};
BunyanNoopLogger.prototype.warn = function () {};
BunyanNoopLogger.prototype.error = function () {};
BunyanNoopLogger.prototype.fatal = function () {};
BunyanNoopLogger.prototype.child = function () { return this; };
BunyanNoopLogger.prototype.end = function () {};



// ---- client API

/**
 * Create a cloudapi client.
 *
 * @param options {Object}
 *      - {String} url (required) Cloud API base url
 *      - {String} user (required) The user login name.
 *        For backward compat, 'options.account' is accepted as a synonym.
 *      - {Function} sign (required) An http-signature auth signing function
 *      - {String} version (optional) Used for the accept-version header. This
 *        defaults to '*', meaning that over time you could experience breaking
 *        changes. Specifying a value is strongly recommended. E.g. '~7.1'.
 *      - {Bunyan Logger} log (optional)
 *      - ... and any other standard restify client options, e.g.:
 *          {String} userAgent
 *          {Boolean} rejectUnauthorized
 *          {Boolean} agent  Set to `false` to not get KeepAlive. You want
 *              this for CLIs.
 *          TODO doc the backoff/retry available options
 * @throws {TypeError} on bad input.
 * @constructor
 *
 * TODO: caching options (copy node-manta/node-moray/node-smartdc?)
 *        - {Boolean} noCache (optional) disable client caching (default false).
 *        - {Boolean} cacheSize (optional) number of cache entries (default 1k).
 *        - {Boolean} cacheExpiry (optional) entry age in seconds (default 60).
 */
function CloudAPI(options) {
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
    assert.string(options.user || options.account, 'options.user');
    assert.func(options.sign, 'options.sign');
    assert.optionalString(options.version, 'options.version');
    assert.optionalObject(options.log, 'options.log');

    this.url = options.url;
    this.user = options.user || options.account;
    this.sign = options.sign;
    this.log = options.log || new BunyanNoopLogger();
    if (!options.version) {
        options.version = '*';
    }
    if (!options.userAgent) {
        options.userAgent = sprintf('sdc/%s (%s-%s; node/%s)',
            SDC_VERSION, OS_ARCH, OS_PLATFORM, process.versions.node);
    }

    // XXX relevant?
    //options.retryCallback = function checkFor500(code) {
    //    return (code === 500);
    //};

    // XXX relevant?
    //this.token = options.token;

    this.client = restify.createJsonClient(options);
}


CloudAPI.prototype._getAuthHeaders = function _getAuthHeaders(callback) {
    assert.func(callback, 'callback');
    var self = this;

    var headers = {};
    headers.date = new Date().toUTCString();
    var sigstr = 'date: ' + headers.date;

    //XXX
    //if (this.token !== undefined) {
    //    obj.headers['X-Auth-Token'] = this.token;
    //}

    self.sign(sigstr, function (err, sig) {
        if (err || !sig) {
            callback(new errors.SigningError(err));
            return;
        }

        headers.authorization = sprintf(
            'Signature keyId="/%s/keys/%s",algorithm="%s",signature="%s"',
            self.user, sig.keyId, sig.algorithm, sig.signature);
        callback(null, headers);
    });
};


// ---- accounts

/**
 * Get the user's account data.
 * <http://apidocs.joyent.com/cloudapi/#GetAccount>
 *
 * @param {Object} options (optional)
 * @param {Function} callback of the form `function (err, user)`
 */
CloudAPI.prototype.getAccount = function (options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.func(callback, 'callback');

    var path = '/' + self.user;
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.get(opts, function (err, req, res, body) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, body, res);
            }
        });
    });
};


// ---- machines

/**
 * List the user's machines.
 * <http://apidocs.joyent.com/cloudapi/#ListMachines>
 *
 * If no `offset` is given, then this will return all machines, calling
 * multiple times if necessary. If `offset` is specified given, then just
 * a single response will be made.
 *
 * @param {Object} options (optional)
 *      - {Number} offset (optional) An offset number of machine at which to
 *        return results.
 *      - {Number} limit (optional) Max number of machines to return.
 * @param {Function} callback of the form `function (err, machines, responses)`
 *      where `responses` is an array of response objects in retrieving all
 *      the machines. ListMachines has a max number of machines, so can require
 *      multiple requests to list all of them.
 */
CloudAPI.prototype.listMachines = function (options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.func(callback, 'callback');

    var query = {
        limit: options.limit
    };

    var paging = options.offset === undefined;
    var offset = options.offset || 0;
    var lastHeaders;
    var responses = [];
    var bodies = [];
    async.doWhilst(
        function getPage(next) {
            self._getAuthHeaders(function (hErr, headers) {
                if (hErr) {
                    next(hErr);
                    return;
                }
                query.offset = offset;
                var path = sprintf('/%s/machines?%s', self.user,
                    querystring.stringify(query));
                var opts = {
                    path: path,
                    headers: headers
                };
                self.client.get(opts, function (err, req, res, body) {
                    lastHeaders = res.headers;
                    responses.push(res);
                    bodies.push(body);
                    next(err);
                });
            });
        },
        function testContinue() {
            if (!paging) {
                return false;
            }
            xQueryLimit = Number(lastHeaders['x-query-limit']);
            xResourceCount = Number(lastHeaders['x-resource-count']);
            assert.number(xQueryLimit, 'x-query-limit header');
            assert.number(xResourceCount, 'x-resource-count header');
            offset += Number(lastHeaders['x-resource-count']);
            return xResourceCount >= xQueryLimit;
        },
        function doneMachines(err) {
            if (err) {
                callback(err, null, responses);
            } else if (bodies.length === 1) {
                callback(null, bodies[0], responses);
            } else {
                var machines = Array.prototype.concat.apply([], bodies);
                callback(null, machines, responses);
            }
        }
    )
};



// --- Exports

module.exports = {
    createClient: function (options) {
        return new CloudAPI(options);
    }
};
