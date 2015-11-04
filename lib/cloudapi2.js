/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
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
 *              account: <ACCOUNT>,         // 'acmecorp'
 *              [user: <RBAC-USER>,]        // 'bob'
 *              log: <BUNYAN-LOGGER>,
 *              sign: auth.cliSigner({
 *                  keyId: <KEY-ID>,        // ssh fingerprint
 *                  // Unfortunately node-smartdc-auth uses user/subuser, while
 *                  // node-triton uses account/user:
 *                  user: <ACCOUNT>,        // 'acmecorp'
 *                  [subuser: <RBAC-USER>,] // 'bob'
 *                  log: <BUNYAN-LOGGER>,
 *              }),
 *              ...
 *      });
 *      client.listImages(function (err, images) { ... });
 *      ...
 *
 */

var assert = require('assert-plus');
var format = require('util').format;
var LOMStream = require('lomstream').LOMStream;
var os = require('os');
var querystring = require('querystring');
var vasync = require('vasync');

var errors = require('./errors');
var SaferJsonClient = require('./SaferJsonClient');



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
 *      - {String} account (required) The account login name.
 *      - {Function} sign (required) An http-signature auth signing function
 *      - {String} user (optional) The RBAC user login name.
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
function CloudApi(options) {
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
    assert.string(options.account, 'options.account');
    assert.func(options.sign, 'options.sign');
    assert.optionalString(options.user, 'options.user');
    assert.optionalString(options.version, 'options.version');
    assert.optionalObject(options.log, 'options.log');

    this.url = options.url;
    this.account = options.account;
    this.user = options.user; // optional RBAC subuser
    this.sign = options.sign;
    this.log = options.log || new BunyanNoopLogger();
    if (!options.version) {
        options.version = '*';
    }
    if (!options.userAgent) {
        options.userAgent = format('triton/%s (%s-%s; node/%s)',
            VERSION, OS_ARCH, OS_PLATFORM, process.versions.node);
    }

    // XXX relevant?
    //options.retryCallback = function checkFor500(code) {
    //    return (code === 500);
    //};

    // TODO support token auth
    //this.token = options.token;

    this.client = new SaferJsonClient(options);
}


CloudApi.prototype._getAuthHeaders = function _getAuthHeaders(callback) {
    assert.func(callback, 'callback');
    var self = this;

    var headers = {};
    headers.date = new Date().toUTCString();
    var sigstr = 'date: ' + headers.date;

    // TODO: token auth support
    //if (this.token !== undefined) {
    //    obj.headers['X-Auth-Token'] = this.token;
    //}

    self.sign(sigstr, function (err, sig) {
        if (err || !sig) {
            callback(new errors.SigningError(err));
            return;
        }

        var ident = self.account;
        if (self.user) {
            ident += '/users/' + self.user;
        }
        headers.authorization = format(
            'Signature keyId="/%s/keys/%s",algorithm="%s",signature="%s"',
            ident, sig.keyId, sig.algorithm, sig.signature);
        callback(null, headers);
    });
};

/**
 * Return an appropriate query string *with the leading '?'* from the given
 * fields. If any of the field values are undefined or null, then they will
 * be excluded.
 */
CloudApi.prototype._qs = function _qs(/* fields1, ...*/) {
    var fields = Array.prototype.slice.call(arguments);

    var query = {};
    fields.forEach(function (field) {
        Object.keys(field).forEach(function (key) {
            var value = field[key];
            if (value !== undefined && value !== null) {
                query[key] = value;
            }
        });
    });

    if (Object.keys(query).length === 0) {
        return '';
    } else {
        return '?' + querystring.stringify(query);
    }
};


/**
 * Return an appropriate full URL *path* given a CloudApi subpath.
 * This handles prepending the API's base path, if any: e.g. if the configured
 * URL is "https://example.com/base/path".
 *
 * Optionally an object of query params can be passed in to include a query
 * string. This just calls `this._qs(...)`.
 */
CloudApi.prototype._path = function _path(subpath /* , qparams, ... */) {
    assert.string(subpath, 'subpath');
    assert.ok(subpath[0] === '/');

    var path = subpath;
    var qparams = Array.prototype.slice.call(arguments, 1);
    path += this._qs.apply(this, qparams);
    return path;
};


/**
 * Cloud API request wrapper - modeled after http.request
 *
 * @param {Object|String} options - object or string for endpoint
 *      - {String} path - URL endpoint to hit
 *      - {String} method - HTTP(s) request method
 *      - {Object} data - data to be passed
 * @param {Function} callback passed via the restify client
 */
CloudApi.prototype._request = function _request(options, callback) {
    var self = this;
    if (typeof (options) === 'string')
        options = {path: options};
    assert.object(options, 'options');
    assert.func(callback, 'callback');
    assert.optionalObject(options.data, 'options.data');

    var method = (options.method || 'GET').toLowerCase();
    assert.ok(['get', 'post', 'delete', 'head'].indexOf(method) >= 0,
        'invalid method given');
    switch (method) {
    case 'delete':
        method = 'del';
        break;
    default:
        break;
    }

    self._getAuthHeaders(function (err, headers) {
        if (err) {
            callback(err);
            return;
        }
        var opts = {
            path: options.path,
            headers: headers
        };
        if (options.data)
            self.client[method](opts, options.data, callback);
        else
            self.client[method](opts, callback);
    });
};

/**
 * A simple wrapper around making a GET request to an endpoint and
 * passing back the body returned
 */
CloudApi.prototype._passThrough = function _passThrough(endpoint, opts, cb) {
    var self = this;
    if (typeof (opts) === 'function') {
        cb = opts;
        opts = null;
    }
    opts = opts || {};

    assert.string(endpoint, 'endpoint');
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var p = this._path(endpoint, opts);
    this._request(p, function (err, req, res, body) {
        /*
         * Improve this kind of error message:
         *
         *  Error: DEPTH_ZERO_SELF_SIGNED_CERT
         *      at SecurePair.<anonymous> (tls.js:1381:32)
         *      at SecurePair.emit (events.js:92:17)
         *
         * TODO: could generalize this into a wrapErr method.
         */
        if (err && err.message === 'DEPTH_ZERO_SELF_SIGNED_CERT' &&
            self.client.rejectUnauthorized)
        {
            err = new errors.SelfSignedCertError(err, self.url);
        }

        cb(err, body, res);
    });
};



// ---- networks

/**
 * Get network information
 *
 * @param {Function} callback of the form `function (err, networks, response)`
 */
CloudApi.prototype.listNetworks = function listNetworks(opts, cb) {
    var endpoint = format('/%s/networks', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#GetNetwork>
 *
 * @param {String} - UUID
 * @param {Function} callback of the form `function (err, network, res)`
 */
CloudApi.prototype.getNetwork = function getNetwork(id, cb) {
    assert.uuid(id, 'id');
    assert.func(cb, 'cb');

    var endpoint = this._path(format('/%s/networks/%s', this.account, id));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};



// ---- datacenters

/**
 * Get services information
 *
 * @param {Function} callback of the form `function (err, services, response)`
 */
CloudApi.prototype.listServices = function listServices(opts, cb) {
    var endpoint = format('/%s/services', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Get datacenters information
 *
 * @param {Function} callback of the form
 *      `function (err, datacenters, response)`
 */
CloudApi.prototype.listDatacenters = function listDatacenters(opts, cb) {
    var endpoint = format('/%s/datacenters', this.account);
    this._passThrough(endpoint, opts, cb);
};


// ---- accounts

/**
 * Get account information
 *
 * @param {Function} callback of the form `function (err, account, response)`
 */
CloudApi.prototype.getAccount = function getAccount(opts, cb) {
    var endpoint = format('/%s', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Get public key information
 *
 * @param {Function} callback of the form `function (err, keys, response)`
 */
CloudApi.prototype.listKeys = function listKeys(opts, cb) {
    var endpoint = format('/%s/keys', this.account);
    this._passThrough(endpoint, opts, cb);
};


// ---- images

/**
 * <http://apidocs.joyent.com/cloudapi/#ListImages>
 *
 * @param {Object} opts (optional)
 *      XXX be more strict about accepted options
 *      XXX document this, see the api doc above :)
 * @param {Function} cb of the form `function (err, images, res)`
 */
CloudApi.prototype.listImages = function listImages(opts, cb) {
    var endpoint = format('/%s/images', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#GetImage>
 *
 * @param {Object} opts
 *      - id {UUID}
 * @param {Function} cb of the form `function (err, image, res)`
 */
CloudApi.prototype.getImage = function getImage(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = this._path(format('/%s/images/%s', this.account, opts.id));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


// ---- packages

/**
 * <http://apidocs.joyent.com/cloudapi/#ListPackages>
 *
 * @param {Object} opts (optional)
 *      XXX be more strict about accepted options
 *      XXX document this, see the api doc above :)
 * @param {Function} callback of the form `function (err, packages, res)`
 */
CloudApi.prototype.listPackages = function listPackages(opts, cb) {
    var endpoint = format('/%s/packages', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#GetPackage>
 *
 * @param {Object} opts
 *      - id {UUID|String} Package ID (a UUID) or name.
 * @param {Function} cb of the form `function (err, package, res)`
 */
CloudApi.prototype.getPackage = function getPackage(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    // XXX use _passThrough?
    var endpoint = this._path(format('/%s/packages/%s', this.account, opts.id));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


// ---- machines

/**
 * Get a machine by id.
 *
 * XXX add getCredentials equivalent
 * XXX cloudapi docs don't doc the credentials=true option
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, response)`
 */
CloudApi.prototype.getMachine = function getMachine(id, cb) {
    assert.uuid(id, 'id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s', this.account, id);
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * delete a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, response)`
 */
CloudApi.prototype.deleteMachine = function deleteMachine(uuid, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');

    var opts = {
        path: format('/%s/machines/%s', self.account, uuid),
        method: 'DELETE'
    };
    this._request(opts, function (err, req, res, body) {
        callback(err, body, res);
    });
};

/**
 * start a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, response)`
 */
CloudApi.prototype.startMachine = function startMachine(uuid, callback) {
    return this._doMachine('start', uuid, callback);
};

/**
 * stop a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, response)`
 */
CloudApi.prototype.stopMachine = function stopMachine(uuid, callback) {
    return this._doMachine('stop', uuid, callback);
};

/**
 * reboot a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, response)`
 */
CloudApi.prototype.rebootMachine = function rebootMachine(uuid, callback) {
    return this._doMachine('reboot', uuid, callback);
};

/**
 * internal function for start/stop/reboot
 */
CloudApi.prototype._doMachine = function _doMachine(action, uuid, callback) {
    var self = this;
    assert.string(action, 'action');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');

    var opts = {
        path: format('/%s/machines/%s', self.account, uuid),
        method: 'POST',
        data: {
            action: action
        }
    };
    this._request(opts, function (err, req, res, body) {
        callback(err, body, res);
    });
};

/**
 * Wait for a machine to go one of a set of specfic states.
 *
 * @param {Object} options
 *      - {String} id - machine UUID
 *      - {Array of String} states - desired state
 *      - {Number} interval (optional) - time in ms to poll
 * @param {Function} callback - called when state is reached or on error
 */
CloudApi.prototype.waitForMachineStates =
        function waitForMachineStates(opts, callback) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.arrayOfString(opts.states, 'opts.states');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(callback, 'callback');
    var interval = (opts.interval === undefined ? 1000 : opts.interval);

    poll();

    function poll() {
        self.getMachine(opts.id, function (err, machine, res) {
            if (err) {
                callback(err, null, res);
                return;
            }
            if (opts.states.indexOf(machine.state) !== -1) {
                callback(null, machine, res);
                return;
            }
            setTimeout(poll, interval);
        });
    }
};

/**
 * List the account's machines.
 * <http://apidocs.joyent.com/cloudapi/#ListMachines>
 *
 * @param {Object} options
 *      See document above
 * @return {LOMStream} a stream for each machine entry
 */
CloudApi.prototype.createListMachinesStream =
function createListMachinesStream(options) {
     var self = this;
     options = options || {};

    // If a `limit` is specified, we don't paginate.
    var once = options.limit !== undefined;

    return new LOMStream({
        fetch: fetch,
        limit: 1000,
        offset: true
    });

    function fetch(fetcharg, limitObj, datacb, donecb) {
        options.limit = limitObj.limit;
        options.offset = limitObj.offset;
        var endpoint = self._path(
            format('/%s/machines', self.account), options);

        self._request(endpoint, function (err, req, res, body) {
            if (err) {
                return donecb(err);
            }
            var resourcecount = res.headers['x-resource-count'];
            var done = once || resourcecount < options.limit;
            donecb(null, {done: done, results: body});
        });
    }
};

/**
 * List the account's machines.
 * <http://apidocs.joyent.com/cloudapi/#ListMachines>
 *
 * @param {Object} options
 *      See document above
 * @param {Function} callback - called like `function (err, machines)`
 */
CloudApi.prototype.listMachines = function listMachines(options, callback) {
    if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    var machines = [];
    var s = this.createListMachinesStream(options);
    s.on('error', function (e) {
        callback(e);
    });
    s.on('readable', function () {
        var machine;
        while ((machine = s.read()) !== null) {
            machines.push(machine);
        }
    });
    s.on('end', function () {
        callback(null, machines);
    });
};


CloudApi.prototype.createMachine = function createMachine(options, callback) {
    assert.object(options, 'options');
    assert.optionalString(options.name, 'options.name');
    assert.uuid(options.image, 'options.image');
    assert.uuid(options.package, 'options.package');
    assert.optionalArrayOfUuid(options.networks, 'options.networks');
    // TODO: assert the other fields
    assert.func(callback, 'callback');

    // XXX how does options.networks array work here?
    this._request({
        method: 'POST',
        path: format('/%s/machines', this.account),
        data: options
    }, function (err, req, res, body) {
        callback(err, body, res);
    });
};


/**
 * List machine audit (successful actions on the machine).
 *
 * XXX IMO this endpoint should be called ListMachineAudit in cloudapi.
 *
 * @param {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, audit, response)`
 */
CloudApi.prototype.machineAudit = function machineAudit(id, cb) {
    assert.uuid(id, 'id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/audit', this.account, id);
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


// --- rbac

/**
 * <http://apidocs.joyent.com/cloudapi/#ListUsers>
 *
 * @param opts {Object} Options (optional)
 * @param cb {Function} Callback of the form `function (err, users, res)`
 */
CloudApi.prototype.listUsers = function listUsers(opts, cb) {
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.func(cb, 'cb');
    assert.object(opts, 'opts');

    var endpoint = format('/%s/users', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#GetUser>
 *
 * @param {Object} opts
 *      - id {UUID|String} The user ID or login.
 *      - membership {Boolean} Optional. Whether to includes roles of which
 *        this user is a member. Default false.
 * @param {Function} callback of the form `function (err, user, res)`
 */
CloudApi.prototype.getUser = function getUser(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.membership, 'opts.membership');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/users/%s', this.account, opts.id);
    this._passThrough(endpoint, {membership: opts.membership}, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#CreateUser>
 *
 * @param {Object} opts (object) user object containing:
 *      - {String} login (required) for your user.
 *      - {String} password (required) for the user.
 *      - {String} email (required) for the user.
 *      - {String} companyName (optional) for the user.
 *      - {String} firstName (optional) for the user.
 *      - {String} lastName (optional) for the user.
 *      - {String} address (optional) for the user.
 *      - {String} postalCode (optional) for the user.
 *      - {String} city (optional) for the user.
 *      - {String} state (optional) for the user.
 *      - {String} country (optional) for the user.
 *      - {String} phone (optional) for the user.
 * @param {Function} cb of the form `function (err, user, res)`
 */
CloudApi.prototype.createUser = function createUser(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.login, 'opts.login');
    assert.string(opts.password, 'opts.password');
    assert.string(opts.email, 'opts.email');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var data = {
        login: opts.login,
        password: opts.password,
        email: opts.email,
        companyName: opts.companyName,
        firstName: opts.firstName,
        lastName: opts.lastName,
        address: opts.address,
        postalCode: opts.postalCode,
        city: opts.city,
        state: opts.state,
        country: opts.country,
        phone: opts.phone
    };

    this._request({
        method: 'POST',
        path: format('/%s/users', this.account),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.joyent.com/cloudapi/#UpdateUser>
 *
 * @param {Object} opts (object) user object containing:
 *      - {String} id (required) for your user.
 *      - {String} email (optional) for the user.
 *      - {String} companyName (optional) for the user.
 *      - {String} firstName (optional) for the user.
 *      - {String} lastName (optional) for the user.
 *      - {String} address (optional) for the user.
 *      - {String} postalCode (optional) for the user.
 *      - {String} city (optional) for the user.
 *      - {String} state (optional) for the user.
 *      - {String} country (optional) for the user.
 *      - {String} phone (optional) for the user.
 * @param {Function} cb of the form `function (err, user, res)`
 */
CloudApi.prototype.updateUser = function updateUser(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var update = {
        email: opts.email,
        companyName: opts.companyName,
        firstName: opts.firstName,
        lastName: opts.lastName,
        address: opts.address,
        postalCode: opts.postalCode,
        city: opts.city,
        state: opts.state,
        country: opts.country,
        phone: opts.phone
    };

    this._request({
        method: 'POST',
        path: format('/%s/users/%s', this.account, opts.id),
        data: update
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * <http://apidocs.joyent.com/cloudapi/#DeleteUser>
 *
 * @param {Object} opts (object) user object containing:
 *      - {String} id (required) for your user.
 * @param {Function} cb of the form `function (err, user, res)`
 */
CloudApi.prototype.deleteUser = function deleteUser(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/users/%s', this.account, opts.id)
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * <http://apidocs.joyent.com/cloudapi/#ListRoles>
 *
 * @param opts {Object} Options (optional)
 * @param cb {Function} Callback of the form `function (err, roles, res)`
 */
CloudApi.prototype.listRoles = function listRoles(opts, cb) {
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.func(cb, 'cb');
    assert.object(opts, 'opts');

    var endpoint = format('/%s/roles', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#GetRole>
 *
 * @param {Object} opts
 *      - id {UUID|String} The role ID or name.
 * @param {Function} callback of the form `function (err, user, res)`
 */
CloudApi.prototype.getRole = function getRole(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/roles/%s', this.account, opts.id);
    this._passThrough(endpoint, {}, cb);
};

/**
 * <http://apidocs.joyent.com/cloudapi/#CreateRole>
 *
 * @param {Object} opts (object) role object containing:
 *      - {String} name (required) for the role.
 *      - {Array} members (optional) for the role.
 *      - {Array} default_members (optional) for the role.
 *      - {Array} policies (optional) for the role.
 * @param {Function} cb of the form `function (err, role, res)`
 */
CloudApi.prototype.createRole = function createRole(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.name, 'opts.name');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var data = {
        name: opts.name,
        default_members: opts.default_members,
        members: opts.members,
        policies: opts.policies
    };

    this._request({
        method: 'POST',
        path: format('/%s/roles', this.account),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.joyent.com/cloudapi/#UpdateRole>
 *
 * @param {Object} opts (object) role object containing:
 *      - {UUID|String} id (required) The role ID or name.
 *      - {String} name (optional) for the role.
 *      - {Array} members (optional) for the role.
 *      - {Array} default_members (optional) for the role.
 *      - {Array} policies (optional) for the role.
 * @param {Function} cb of the form `function (err, role, res)`
 */
CloudApi.prototype.updateRole = function updateRole(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var update = {
        name: opts.name,
        members: opts.members,
        default_members: opts.default_members,
        policies: opts.policies
    };

    this._request({
        method: 'POST',
        path: format('/%s/roles/%s', this.account, opts.id),
        data: update
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * <http://apidocs.joyent.com/cloudapi/#DeleteRole>
 *
 * @param {Object} opts (object) user object containing:
 *      - {String} id (required) of the role to delete.
 * @param {Function} cb of the form `function (err, user, res)`
 */
CloudApi.prototype.deleteRole = function deleteRole(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/roles/%s', this.account, opts.id)
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};



// --- Exports

module.exports.createClient = function (options) {
    return new CloudApi(options);
};
