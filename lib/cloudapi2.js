/*
 * Copyright (c) 2015, Joyent, Inc. All rights reserved.
 *
 * Client library for the SmartDataCenter Cloud API (cloudapi).
 * http://apidocs.joyent.com/cloudapi/
 *
 * Usage example::
 *
 *      var auth = require('smartdc-auth');
 *      var cloudapi = require('./lib/cloudapi2');
 *      var client = cloudapi.createClient({
 *              url: <URL>,                 // 'https://us-sw-1.api.joyent.com',
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
var auth = require('smartdc-auth');
var format = require('util').format;
var os = require('os');
var querystring = require('querystring');
var restifyClients = require('restify-clients');
var sprintf = require('util').format;
var vasync = require('vasync');

var errors = require('./errors');



// ---- globals

var VERSION = require('../package.json').version;
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
        options.userAgent = sprintf('triton/%s (%s-%s; node/%s)',
            VERSION, OS_ARCH, OS_PLATFORM, process.versions.node);
    }

    // XXX relevant?
    //options.retryCallback = function checkFor500(code) {
    //    return (code === 500);
    //};

    // XXX relevant?
    //this.token = options.token;

    this.client = restifyClients.createJsonClient(options);
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

/**
 * Return an appropriate query string *with the leading '?'* from the given
 * fields. If any of the field values are undefined or null, then they will
 * be excluded.
 */
CloudAPI.prototype._qs = function _qs(fields, fields2) {
    assert.object(fields, 'fields');
    assert.optionalObject(fields2, 'fields2'); // can be handy to pass in 2 objs

    var query = {};
    Object.keys(fields).forEach(function (key) {
        var value = fields[key];
        if (value !== undefined && value !== null) {
            query[key] = value;
        }
    });
    if (fields2) {
        Object.keys(fields2).forEach(function (key) {
            var value = fields2[key];
            if (value !== undefined && value !== null) {
                query[key] = value;
            }
        });
    }

    if (Object.keys(query).length === 0) {
        return '';
    } else {
        return '?' + querystring.stringify(query);
    }
};


/**
 * Return an appropriate full URL *path* given an CloudAPI subpath.
 * This handles prepending the API's base path, if any: e.g. if the configured
 * URL is "https://example.com/base/path".
 *
 * Optionally an object of query params can be passed in to include a query
 * string. This just calls `this._qs(...)`.
 */
CloudAPI.prototype._path = function _path(subpath, qparams, qparams2) {
    assert.string(subpath, 'subpath');
    assert.ok(subpath[0] === '/');
    assert.optionalObject(qparams, 'qparams');
    assert.optionalObject(qparams2, 'qparams2'); // can be handy to pass in 2

    var path = subpath;
    if (qparams) {
        path += this._qs(qparams, qparams2);
    }
    return path;
};



// ---- accounts

/**
 * Get the user's account data.
 * <http://apidocs.joyent.com/cloudapi/#GetAccount>
 *
 * @param {Object} options (optional)
 * @param {Function} callback of the form `function (err, user)`
 */
CloudAPI.prototype.getAccount = function getAccount(options, callback) {
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


// ---- images

/**
 * <http://apidocs.joyent.com/cloudapi/#ListImages>
 *
 * @param {Object} options (optional)
 *      XXX document this, see the api doc above :)
 * @param {Function} callback of the form `function (err, images, res)`
 */
CloudAPI.prototype.listImages = function listImages(options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.func(callback, 'callback');

    var query = {
        name: options.name,
        os: options.os,
        version: options.version,
        public: options.public,
        state: options.state,
        owner: options.owner,
        type: options.type
    };

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var opts = {
            path: self._path(format('/%s/images', self.user), query),
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
 * Get a machine by id.
 *
 * XXX add getCredentials equivalent
 * XXX cloudapi docs don't doc the credentials=true option
 *
 * @param {Object} options
 *      - {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, response)`
 */
CloudAPI.prototype.getMachine = function getMachine(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.id, 'options.id');
    assert.func(callback, 'callback');

    var path = sprintf('/%s/machines/%s', self.user, options.id);
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
CloudAPI.prototype.listMachines = function listMachines(options, callback) {
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



/**
 * List machine audit (successful actions on the machine).
 *
 * XXX IMO this endpoint should be called ListMachineAudit in cloudapi.
 *
 * @param {Object} options
 *      - {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, audit, response)`
 */
CloudAPI.prototype.machineAudit = function machineAudit(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.id, 'options.id');
    assert.func(callback, 'callback');

    var path = sprintf('/%s/machines/%s/audit', self.user, options.id);
    //XXX This `client.get` block is duplicated. Add a convenience function for it:
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



// --- Exports

module.exports = {
    createClient: function (options) {
        return new CloudAPI(options);
    }
};
