/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 *
 * Client library for the SmartDataCenter Cloud API (cloudapi).
 * http://apidocs.tritondatacenter.com/cloudapi/
 *
 * Usage example::
 *
 *      var auth = require('smartdc-auth');
 *      var cloudapi = require('./lib/cloudapi2');
 *      var client = cloudapi.createClient({
 *              url: <URL>,                 // 'https://cloudapi.$dc.$suffix',
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
var auth = require('smartdc-auth');
var mod_watershed = require('watershed');
var mod_restify = require('restify-clients');

var bunyannoop = require('./bunyannoop');
var common = require('./common');
var errors = require('./errors');
var SaferJsonClient = require('./SaferJsonClient');

var shed = new mod_watershed.Watershed();

// ---- globals

var VERSION = require('../package.json').version;
var OS_ARCH = os.arch();
var OS_PLATFORM = os.platform();



// ---- client API

/**
 * Create a cloudapi client.
 *
 * @param options {Object}
 *      - {String} url (required) Cloud API base url
 *      - Authentication options (see below)
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
 *
 *      Authentication options can be given in two ways - either with a
 *      smartdc-auth KeyPair (the preferred method), or with a signer function
 *      (deprecated, retained for compatibility).
 *
 *      Either (prefered):
 *      - {String} account (required) The account login name this cloudapi
 *          client will operate upon.
 *      - {Object} principal (required)
 *          - {String} account (required) The account login name for
 *              authentication.
 *          - {Object} keyPair (required) A smartdc-auth KeyPair object
 *          - {String} user (optional) RBAC sub-user login name
 *          - {Array of String} roles (optional) RBAC role(s) to take up.
 *
 *      Or (backwards compatible):
 *      - {String} account (required) The account login name used both for
 *          authentication and as the account being operated upon.
 *      - {Function} sign (required) An http-signature auth signing function.
 *      - {String} user (optional) The RBAC user login name.
 *      - {Array of String} roles (optional) RBAC role(s) to take up.
 *
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

    assert.optionalArrayOfString(options.roles, 'options.roles');
    assert.optionalString(options.version, 'options.version');
    assert.optionalObject(options.log, 'options.log');

    assert.optionalObject(options.principal, 'options.principal');
    this.principal = options.principal;
    if (options.principal === undefined) {
        this.principal = {};
        this.principal.account = options.account;
        assert.optionalString(options.user, 'options.user');
        if (options.user !== undefined) {
            this.principal.user = options.user;
        }
        assert.func(options.sign, 'options.sign');
        this.principal.sign = options.sign;
    } else {
        assert.string(this.principal.account, 'principal.account');
        assert.object(this.principal.keyPair, 'principal.keyPair');
        assert.optionalString(this.principal.user, 'principal.user');
    }

    this.url = options.url;
    this.account = options.account;
    this.roles = options.roles;
    this.log = options.log || new bunyannoop.BunyanNoopLogger();
    if (!options.version) {
        options.version = '*';
    }
    if (!options.userAgent) {
        options.userAgent = format('triton/%s (%s-%s; node/%s)',
            VERSION, OS_ARCH, OS_PLATFORM, process.versions.node);
    }

    // XXX relevant?
    // options.retryCallback = function checkFor500(code) {
    //    return (code === 500);
    // };

    // TODO support token auth
    // this.token = options.token;

    this.client = new SaferJsonClient(options);

    // We must use a plain HttpClient for creating websockets
    this.webSocketClient = new mod_restify.HttpClient(options);
}

CloudApi.prototype.close = function close() {
    this.log.trace({host: this.client.url && this.client.url.host},
        'close cloudapi http client');
    this.client.close();
};

CloudApi.prototype._getAuthHeaders =
    function _getAuthHeaders(method, path, callback) {
    assert.string(method, 'method');
    assert.string(path, 'path');
    assert.func(callback, 'callback');

    var headers = {};

    var rs;
    if (this.principal.sign !== undefined) {
        rs = auth.requestSigner({
            sign: this.principal.sign
        });
    } else if (this.principal.keyPair !== undefined) {
        try {
            rs = this.principal.keyPair.createRequestSigner({
                user: this.principal.account,
                subuser: this.principal.user
            });
        } catch (signerErr) {
            callback(new errors.SigningError(signerErr));
            return;
        }
    }

    rs.writeTarget(method, path);
    headers.date = rs.writeDateHeader();

    // TODO: token auth support
    // if (this.token !== undefined) {
    //    obj.headers['X-Auth-Token'] = this.token;
    // }

    rs.sign(function (err, authz) {
        if (err || !authz) {
            callback(new errors.SigningError(err));
            return;
        }
        headers.authorization = authz;
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
 * @param {Object|String} opts - object or string for endpoint
 *      - {String} path - URL endpoint to hit
 *      - {String} method - HTTP(s) request method
 *      - {Object} data - data to be passed
 *      - {Object} headers - optional additional request headers
 * @param {Function} cb passed via the restify client
 */
CloudApi.prototype._request = function _request(opts, cb) {
    var self = this;
    if (typeof (opts) === 'string')
        opts = {path: opts};
    assert.object(opts, 'opts');
    assert.optionalObject(opts.data, 'opts.data');
    assert.optionalString(opts.method, 'opts.method');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    var method = (opts.method || 'GET').toLowerCase();
    assert.ok(['get', 'post', 'put', 'delete', 'head'].indexOf(method) >= 0,
        'invalid HTTP method given');
    var clientFnName = (method === 'delete' ? 'del' : method);

    if (self.roles && self.roles.length > 0) {
        if (opts.path.indexOf('?') !== -1) {
            opts.path += '&as-role=' + self.roles.join(',');
        } else {
            opts.path += '?as-role=' + self.roles.join(',');
        }
    }

    self._getAuthHeaders(method, opts.path, function (err, headers) {
        if (err) {
            cb(err);
            return;
        }
        if (opts.headers) {
            common.objMerge(headers, opts.headers);
        }
        var reqOpts = {
            path: opts.path,
            headers: headers
        };
        if (opts.data)
            self.client[clientFnName](reqOpts, opts.data, cb);
        else
            self.client[clientFnName](reqOpts, cb);
    });
};

CloudApi.prototype._createWebSocket = function _createWebSocket(opts, cb) {
    var self = this;
    if (typeof (opts) === 'string')
        opts = {path: opts};
    assert.object(opts, 'opts');
    assert.optionalObject(opts.data, 'opts.data');
    assert.optionalString(opts.method, 'opts.method');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    var method = (opts.method || 'GET').toLowerCase();

    // GET and POST are the only two methods that seem to make sense for
    // creating a websocket
    assert.ok(['get', 'post'].indexOf(method) >= 0,
        'invalid HTTP method given');

    if (self.roles && self.roles.length > 0) {
        if (opts.path.indexOf('?') !== -1) {
            opts.path += '&as-role=' + self.roles.join(',');
        } else {
            opts.path += '?as-role=' + self.roles.join(',');
        }
    }

    self._getAuthHeaders(method, opts.path, function authCb(err, headers) {
        if (err) {
            cb(err);
            return;
        }

        var wskey = shed.generateKey();

        if (opts.headers) {
            common.objMerge(headers, opts.headers);
        }
        common.objMerge(headers, {
            'connection': 'upgrade',
            'upgrade': 'websocket',
            'sec-websocket-key': wskey,
            'sec-websocket-version': 13
        });

        var reqOpts = {
            path: opts.path,
            headers: headers
        };

        var upgradeCb = function upgradeCbFn(ugErr, req, res, body) {
            if (ugErr) {
                cb(ugErr);
                return;
            }

            req.on('result', function resultCb(resErr, reqRes) {
                if (resErr) {
                    cb(resErr);
                    return;
                }
            });

            req.once('upgradeResult', function upCb(urErr, uRes, socket, head) {
                if (urErr) {
                    cb(urErr);
                    return;
                }

                socket.setNoDelay(true);
                var client = shed.connect(uRes, socket, head, wskey);
                cb(null, client, uRes);
            });
        };

        if (opts.data)
            self.webSocketClient[method](reqOpts, opts.data, upgradeCb);
        else
            self.webSocketClient[method](reqOpts, upgradeCb);
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
    this._request({path: p}, function (err, req, res, body) {
        /*
         * Improve this kind of error message:
         *
         *  Error: DEPTH_ZERO_SELF_SIGNED_CERT
         *      at SecurePair.<anonymous> (tls.js:1381:32)
         *      at SecurePair.emit (events.js:92:17)
         *
         * TODO: could generalize this into a wrapErr method.
         * TODO: this should be on _request, no? So that PUT, POST, etc. get it.
         */
        if (err && err.message === 'DEPTH_ZERO_SELF_SIGNED_CERT' &&
            self.client.rejectUnauthorized) {
            err = new errors.SelfSignedCertError(err, self.url);
        }

        cb(err, body, res);
    });
};


// ---- ping

CloudApi.prototype.ping = function ping(opts, cb) {
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var reqOpts = {
        path: '/--ping',
        // Ping should be fast. We don't want 15s of retrying.
        retry: false
    };
    this.client.get(reqOpts, function (err, req, res, body) {
        cb(err, body, res);
    });
};


// ---- config

/**
 * Get config object for the current user.
 *
 * @param {Object} opts
 * @param {Function} cb of the form `function (err, config, res)`
 */
CloudApi.prototype.getConfig = function getConfig(opts, cb) {
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var endpoint = this._path(format('/%s/config', this.account));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Set config object for the current user.
 *
 * @param {Object} opts
 *      - {String} default_network: network fabric docker containers are
 *          provisioned on. Optional.
 * @param {Function} cb of the form `function (err, config, res)`
 */
CloudApi.prototype.updateConfig = function updateConfig(opts, cb) {
    assert.object(opts, 'opts');
    assert.optionalUuid(opts.default_network, 'opts.default_network');
    assert.func(cb, 'cb');

    this._request({
        method: 'PUT',
        path: format('/%s/config', this.account),
        data: opts
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


// ---- networks

/**
 * Get network information
 *
 * @param {Function} callback of the form `function (err, networks, res)`
 */
CloudApi.prototype.listNetworks = function listNetworks(opts, cb) {
    var endpoint = format('/%s/networks', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetNetwork>
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

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListNetworkIPs>
 *
 * @param {String} id - The network UUID. Required.
 * @param {Function} callback of the form `function (err, ips, res)`
 */
CloudApi.prototype.listNetworkIps = function listNetworkIps(id, cb) {
    assert.uuid(id, 'id');
    assert.func(cb, 'cb');

    var endpoint = this._path(format('/%s/networks/%s/ips', this.account, id));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetNetworkIP>
 *
 * @param {Object} opts
 *      - {String} id - The network UUID. Required.
 *      - {String} ip - The IP. Required.
 * @param {Function} callback of the form `function (err, ip, res)`
 */
CloudApi.prototype.getNetworkIp = function getNetworkIp(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.ip, 'opts.ip');
    assert.func(cb, 'cb');

    var endpoint = this._path(format('/%s/networks/%s/ips/%s',
        this.account, opts.id, opts.ip));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#UpdateNetworkIP>
 *
 * @param {Object} opts
 *      - {String} id - The network UUID. Required.
 *      - {String} ip - The IP. Required.
 *      - {Boolean} reserved - Reserve the IP. Required.
 * @param {Function} callback of the form `function (err, body, res)`
 */
CloudApi.prototype.updateNetworkIp = function updateNetworkIp(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.ip, 'opts.ip');
    assert.bool(opts.reserved, 'opts.reserved');
    assert.func(cb, 'cb');

    var endpoint = this._path(format('/%s/networks/%s/ips/%s',
        this.account, opts.id, opts.ip));
    var data = {
        reserved: opts.reserved
    };

    this._request({
        method: 'PUT',
        path: endpoint,
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

// <updatable network ip field> -> <expected typeof>
CloudApi.prototype.UPDATE_NETWORK_IP_FIELDS = {
    reserved: 'boolean'
};


// --- Fabric VLANs

/**
 * Creates a network on a fabric VLAN.
 *
 * @param {Object} options object containing:
 *      - {Integer} vlan_id (required) VLAN's id, between 0-4095.
 *      - {String} name (required) A name to identify the network.
 *      - {String} subnet (required) CIDR description of the network.
 *      - {String} provision_start_ip (required) First assignable IP addr.
 *      - {String} provision_end_ip (required) Last assignable IP addr.
 *      - {String} gateway (optional) Gateway IP address.
 *      - {Array} resolvers (optional) DNS resolvers for hosts on network.
 *      - {Object} routes (optional) Static routes for hosts on network.
 *      - {String} description (optional)
 *      - {Boolean} internet_nat (optional) Whether to provision an Internet
 *          NAT on the gateway address (default: true).
 * @param {Function} callback of the form f(err, vlan, res).
 */
CloudApi.prototype.createFabricNetwork =
function createFabricNetwork(opts, cb) {
    assert.object(opts, 'opts');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.string(opts.name, 'opts.name');
    assert.string(opts.subnet, 'opts.subnet');
    assert.string(opts.provision_start_ip, 'opts.provision_start_ip');
    assert.string(opts.provision_end_ip, 'opts.provision_end_ip');
    assert.optionalString(opts.gateway, 'opts.gateway');
    assert.optionalArrayOfString(opts.resolvers, 'opts.resolvers');
    assert.optionalObject(opts.routes, 'opts.routes');
    assert.optionalBool(opts.internet_nat, 'opts.internet_nat');

    var data = common.objCopy(opts);
    var vlanId = data.vlan_id;
    delete data.vlan_id;

    this._request({
        method: 'POST',
        path: format('/%s/fabrics/default/vlans/%d/networks', this.account,
                     vlanId),
        data: data
    }, function reqCb(err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Lists all networks on a VLAN.
 *
 * Returns an array of objects.
 *
 * @param {Object} options object containing:
 *      - {Integer} vlan_id (required) VLAN's id, between 0-4095.
 * @param {Function} callback of the form f(err, networks, res).
 */
CloudApi.prototype.listFabricNetworks =
function listFabricNetworks(opts, cb) {
    assert.object(opts, 'opts');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/fabrics/default/vlans/%d/networks',
                          this.account, opts.vlan_id);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Remove a fabric network
 *
 * @param {Object} opts (object)
 *      - {String} id: The network id. Required.
 *      - {Integer} vlan_id: The VLAN id. Required.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.deleteFabricNetwork =
function deleteFabricNetwork(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/fabrics/default/vlans/%d/networks/%s', this.account,
                     opts.vlan_id, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};

/**
 * Creates a VLAN on a fabric.
 *
 * @param {Object} options object containing:
 *      - {Integer} vlan_id (required) VLAN's id, between 0-4095.
 *      - {String} name (required) A name to identify the VLAN.
 *      - {String} description (optional)
 * @param {Function} callback of the form f(err, vlan, res).
 */
CloudApi.prototype.createFabricVlan =
function createFabricVlan(opts, cb) {
    assert.object(opts, 'opts');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.string(opts.name, 'opts.name');
    assert.optionalString(opts.description, 'opts.description');

    var data = {
        vlan_id: opts.vlan_id
    };

    Object.keys(this.UPDATE_VLAN_FIELDS).forEach(function (attr) {
        if (opts[attr] !== undefined)
            data[attr] = opts[attr];
    });

    this._request({
        method: 'POST',
        path: format('/%s/fabrics/default/vlans', this.account),
        data: data
    }, function reqCb(err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Lists all the VLANs.
 *
 * Returns an array of objects.
 *
 * @param opts {Object} Options
 * @param {Function} callback of the form f(err, vlans, res).
 */
CloudApi.prototype.listFabricVlans =
function listFabricVlans(opts, cb) {
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/fabrics/default/vlans', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Retrieves a VLAN.
 *
 * @param {Integer} id: The VLAN id.
 * @param {Function} callback of the form `function (err, vlan, res)`
 */
CloudApi.prototype.getFabricVlan =
function getFabricVlan(opts, cb) {
    assert.object(opts, 'opts');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/fabrics/default/vlans/%d', this.account,
        opts.vlan_id);
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};

// <updatable account field> -> <expected typeof>
CloudApi.prototype.UPDATE_VLAN_FIELDS = {
    name: 'string',
    description: 'string'
};

/**
 * Updates a VLAN.
 *
 * @param {Object} opts object containing:
 *      - {Integer} id: The VLAN id. Required.
 *      - {String} name: The VLAN name. Optional.
 *      - {String} description: Description of the VLAN. Optional.
 * @param {Function} callback of the form `function (err, vlan, res)`
 */
CloudApi.prototype.updateFabricVlan =
function updateFabricVlan(opts, cb) {
    assert.object(opts, 'opts');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.optionalString(opts.rule, 'opts.name');
    assert.optionalString(opts.description, 'opts.description');
    assert.func(cb, 'cb');

    var data = {};
    Object.keys(this.UPDATE_VLAN_FIELDS).forEach(function (attr) {
        if (opts[attr] !== undefined)
            data[attr] = opts[attr];
    });

    var vlanId = opts.vlan_id;

    this._request({
        method: 'POST',
        path: format('/%s/fabrics/default/vlans/%d', this.account, vlanId),
        data: data
    }, function onReq(err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Remove a VLAN.
 *
 * @param {Object} opts (object)
 *      - {Integer} vlan_id: The vlan id. Required.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.deleteFabricVlan =
function deleteFabricVlan(opts, cb) {
    assert.object(opts, 'opts');
    assert.number(opts.vlan_id, 'opts.vlan_id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/fabrics/default/vlans/%d', this.account, opts.vlan_id)
    }, function onReq(err, req, res) {
        cb(err, res);
    });
};


// ---- datacenters

/**
 * Get services information
 *
 * @param {Function} callback of the form `function (err, services, res)`
 */
CloudApi.prototype.listServices = function listServices(opts, cb) {
    var endpoint = format('/%s/services', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Get datacenters information
 *
 * @param {Function} callback of the form `function (err, datacenters, res)`
 */
CloudApi.prototype.listDatacenters = function listDatacenters(opts, cb) {
    var endpoint = format('/%s/datacenters', this.account);
    this._passThrough(endpoint, opts, cb);
};


// ---- accounts

/**
 * Get account information
 *
 * @param {Function} callback of the form `function (err, account, res)`
 */
CloudApi.prototype.getAccount = function getAccount(opts, cb) {
    var endpoint = format('/%s', this.account);
    this._passThrough(endpoint, opts, cb);
};


/**
 * Get account provisioning limits.
 *
 * @param {Function} callback of the form `function (err, limits, res)`
 */
CloudApi.prototype.getAccountLimits = function getAccountLimits(opts, cb) {
    var endpoint = format('/%s/limits', this.account);
    this._passThrough(endpoint, opts, cb);
};


// <updatable account field> -> <expected typeof>
CloudApi.prototype.UPDATE_ACCOUNT_FIELDS = {
    email: 'string',
    companyName: 'string',
    firstName: 'string',
    lastName: 'string',
    address: 'string',
    postalCode: 'string',
    city: 'string',
    state: 'string',
    country: 'string',
    phone: 'string',
    triton_cns_enabled: 'boolean'
};

/**
 * Update account fields.
 * <https://apidocs.tritondatacenter.com/cloudapi/#UpdateAccount>
 *
 * @param opts {Object} A key for each account field to update.
 * @param cb {Function} `function (err, updatedAccount, res)`
 */
CloudApi.prototype.updateAccount = function updateAccount(opts, cb) {
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var self = this;
    var update = {};
    var unexpectedFields = [];
    Object.keys(opts).forEach(function (field) {
        var type = self.UPDATE_ACCOUNT_FIELDS[field];
        if (type) {
            assert[type === 'boolean' ? 'bool' : type](opts[field],
                'opts.' + field);
            update[field] = opts[field];
        } else {
            unexpectedFields.push(field);
        }
    });
    if (unexpectedFields.length > 0) {
        throw new Error(format('unknown field(s) for UpdateAccount: %s',
            unexpectedFields.sort().join(', ')));
    }

    this._request({
        method: 'POST',
        path: format('/%s', this.account),
        data: update
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * List account's SSH keys.
 *
 * @param {Object} opts (object)
 * @param {Function} callback of the form `function (err, keys, res)`
 */
CloudApi.prototype.listKeys = function listKeys(opts, cb) {
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/keys', this.account);
    this._passThrough(endpoint, {}, cb);
};


/**
 * Get an account's SSH key.
 *
 * @param {Object} opts (object)
 *      - {String} fingerprint (required*) The SSH key fingerprint. One of
 *        'fingerprint' or 'name' is required.
 *      - {String} name (required*) The SSH key name. One of 'fingerprint'
 *        or 'name' is required.
 * @param {Function} callback of the form `function (err, body, res)`
 */
CloudApi.prototype.getKey = function getKey(opts, cb) {
    assert.object(opts, 'opts');
    assert.optionalString(opts.fingerprint, 'opts.fingerprint');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var identifier = opts.fingerprint || opts.name;
    assert.ok(identifier, 'one of "fingerprint" or "name" is required');

    var endpoint = format('/%s/keys/%s', this.account,
        encodeURIComponent(identifier));
    this._passThrough(endpoint, {}, cb);
};


/**
 * Create/upload a new account SSH public key.
 *
 * @param {Object} opts (object)
 *      - {String} key (required) The SSH public key content.
 *      - {String} name (optional) A name for the key. If not given, the
 *        key fingerprint will be used.
 * @param {Function} callback of the form `function (err, key, res)`
 */
CloudApi.prototype.createKey = function createKey(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.key, 'opts.key');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var data = {
        name: opts.name,
        key: opts.key
    };

    this._request({
        method: 'POST',
        path: format('/%s/keys', this.account),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Delete an account's SSH key.
 *
 * @param {Object} opts (object)
 *      - {String} fingerprint (required*) The SSH key fingerprint. One of
 *        'fingerprint' or 'name' is required.
 *      - {String} name (required*) The SSH key name. One of 'fingerprint'
 *        or 'name' is required.
 * @param {Function} callback of the form `function (err, res)`
 */
CloudApi.prototype.deleteKey = function deleteKey(opts, cb) {
    assert.object(opts, 'opts');
    assert.optionalString(opts.fingerprint, 'opts.fingerprint');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var identifier = opts.fingerprint || opts.name;
    assert.ok(identifier, 'one of "fingerprint" or "name" is required');

    this._request({
        method: 'DELETE',
        path: format('/%s/keys/%s', this.account,
            encodeURIComponent(identifier))
    }, function (err, req, res) {
        cb(err, res);
    });
};


// ---- images

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListImages>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetImage>
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


/**
 * Delete an image by id.
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteImage>
 *
 * @param {String} id (required) The image id.
 * @param {Function} callback of the form `function (err, res)`
 */
CloudApi.prototype.deleteImage = function deleteImage(id, callback) {
    var self = this;
    assert.uuid(id, 'id');
    assert.func(callback, 'callback');

    var opts = {
        path: format('/%s/images/%s', self.account, id),
        method: 'DELETE'
    };
    this._request(opts, function (err, req, res) {
        callback(err, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#CreateImageFromMachine>
 *
 * @param {Object} opts
 *      - {UUID} machine  Required. The ID of the machine from which to create
 *        the image.
 *      - {String} name  Required. The image name.
 *      - {String} version  Required. The image version.
 *      - {String} description  Optional. A short description.
 *      - {String} homepage  Optional. Homepage URL.
 *      - {String} eula  Optional. EULA URL.
 *      - {Array} acl  Optional. An array of account UUIDs to which to give
 *        access. "Access Control List."
 *      - {Object} tags  Optional.
 * @param {Function} cb of the form `function (err, image, res)`
 */
CloudApi.prototype.createImageFromMachine =
function createImageFromMachine(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.machine, 'opts.machine');
    assert.string(opts.name, 'opts.name');
    assert.string(opts.version, 'opts.version');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalString(opts.homepage, 'opts.homepage');
    assert.optionalString(opts.eula, 'opts.eula');
    assert.optionalArrayOfUuid(opts.acl, 'opts.acl');
    assert.optionalObject(opts.tags, 'opts.tags');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/images', this.account),
        data: opts
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Export an image to Manta.
 * <http://apidocs.tritondatacenter.com/cloudapi/#ExportImage>
 *
 * @param {Object} opts
 *      - {UUID} id  Required.  The id of the image to export.
 *      - {String} manta_path  Required.  The path in Manta to write the image.
 * @param {Function} cb of the form `function (err, exportInfo, res)`
 */
CloudApi.prototype.exportImage = function exportImage(opts, cb) {
    assert.uuid(opts.id, 'id');
    assert.string(opts.manta_path, 'manta_path');
    assert.func(cb, 'cb');
    var data = {
        action: 'export',
        manta_path: opts.manta_path
    };

    this._request({
        method: 'POST',
        path: format('/%s/images/%s', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

CloudApi.prototype.UPDATE_IMAGE_FIELDS = {
    name: 'string',
    version: 'string',
    description: 'string',
    homepage: 'string',
    eula: 'string',
    acl: 'array',
    tags: 'object'
};

/**
 * Update an image.
 * <http://apidocs.tritondatacenter.com/cloudapi/#UpdateImage>
 *
 * @param {Object} opts
 *      - {UUID} id  Required.  The id of the image to update.
 *      - {Object} fields  Required.  The fields to update in the image.
 * @param {Function} cb of the form `function (err, body, res)`
 */
CloudApi.prototype.updateImage = function updateImage(opts, cb) {
    assert.uuid(opts.id, 'id');
    assert.object(opts.fields, 'fields');
    assert.func(cb, 'cb');
    var self = this;

    var unexpectedFields = [];
    Object.keys(opts.fields).forEach(function (field) {
        var type = self.UPDATE_IMAGE_FIELDS[field];
        if (type) {
            assert[type](opts.fields[field], 'opts.fields ' + field);
        } else {
            unexpectedFields.push(field);
        }
    });

    if (unexpectedFields.length > 0) {
        throw new Error(format('unknown field(s) for UpdateImage: %s',
            unexpectedFields.sort().join(', ')));
    }

    this._request({
        method: 'POST',
        path: format('/%s/images/%s?action=update', this.account, opts.id),
        data: opts.fields
    }, function (err, req, res, body) {
        if (err) {
            cb(err, null, res);
            return;
        }
        cb(null, body, res);
    });
};

/**
 * Clone an image.
 * <http://apidocs.tritondatacenter.com/cloudapi/#CloneImage>
 *
 * @param {Object} opts
 *      - {UUID} id  Required.  The id of the image to update.
 * @param {Function} cb of the form `function (err, body, res)`
 */
CloudApi.prototype.cloneImage = function cloneImage(opts, cb) {
    assert.uuid(opts.id, 'id');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/images/%s?action=clone', this.account, opts.id),
        data: {}
    }, function (err, req, res, body) {
        if (err) {
            cb(err, null, res);
            return;
        }
        cb(null, body, res);
    });
};

/**
 * Import image from another datacenter in the same cloud.
 * <http://apidocs.tritondatacenter.com/cloudapi/#ImportImageFromDatacenter>
 *
 * @param {Object} opts
 *      - {String} datacenter  Required.  The datacenter to import from.
 *      - {UUID} id  Required.  The id of the image to update.
 * @param {Function} cb of the form `function (err, body, res)`
 */
CloudApi.prototype.importImageFromDatacenter =
function importImageFromDatacenter(opts, cb) {
    assert.string(opts.datacenter, 'datacenter');
    assert.uuid(opts.id, 'id');
    assert.func(cb, 'cb');

    var p = this._path(format('/%s/images', this.account), {
        action: 'import-from-datacenter',
        datacenter: opts.datacenter,
        id: opts.id
    });

    this._request({
        method: 'POST',
        path: p,
        data: {}
    }, function (err, req, res, body) {
        if (err) {
            cb(err, null, res);
            return;
        }
        cb(null, body, res);
    });
};

/**
 * Wait for an image to go one of a set of specfic states.
 *
 * @param {Object} options
 *      - {String} id - machine UUID
 *      - {Array of String} states - desired state
 *      - {Number} interval (optional) - Time in ms to poll. Default is 1000ms.
 * @param {Function} cb - `function (err, image, res)`
 *      Called when state is reached or on error
 */
CloudApi.prototype.waitForImageStates =
function waitForImageStates(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.arrayOfString(opts.states, 'opts.states');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(cb, 'cb');
    var interval = (opts.interval === undefined ? 1000 : opts.interval);
    assert.ok(interval > 0, 'interval must be a positive number');

    poll();

    function poll() {
        self.getImage({id: opts.id}, function (err, img, res) {
            if (err) {
                cb(err, null, res);
                return;
            }
            if (opts.states.indexOf(img.state) !== -1) {
                cb(null, img, res);
                return;
            }
            setTimeout(poll, interval);
        });
    }
};


// ---- packages

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListPackages>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetPackage>
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

/*
 * Until we get anything more than VMs from CloudAPI's changefeed, lets
 * keep this with machines.
 */

/**
 * Connect to CloudAPI's Feed of machines changes.
 *
 * @param {Function} callback of the form `function (err, shed, res)`
 */
CloudApi.prototype.changeFeed = function changeFeed(cb) {
    this._createWebSocket({
        path: format('/%s/changefeed', this.account)
    }, cb);
};

/**
 * Get a machine by id.
 *
 * For backwards compat, calling with `getMachine(id, cb)` is allowed.
 *
 * @param {Object} opts
 *      - {UUID} id - Required. The machine id.
 *      - {Boolean} credentials - Optional. Set to true to include generated
 *        credentials for this machine in `machine.metadata.credentials`.
 * @param {Function} cb of the form `function (err, machine, res)`
 */
CloudApi.prototype.getMachine = function getMachine(opts, cb) {
    if (typeof (opts) === 'string') {
        opts = {id: opts};
    }
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.optionalBool(opts.credentials, 'opts.credentials');

    var query = {};
    if (opts.credentials) {
        query.credentials = 'true';
    }
    var p = this._path(format('/%s/machines/%s', this.account, opts.id), query);
    this._request(p, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Connect a VNC connection to a HVM's console
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, shed, res)`
 */
CloudApi.prototype.getMachineVnc = function getMachineVnc(uuid, cb) {
    var endpoint = format('/%s/machines/%s/vnc', this.account, uuid);
    this._createWebSocket({path: endpoint}, cb);
};

/**
 * resize a machine by id.
 *
 * @param {Object} opts
 *      - id {UUID} Required. The machine id.
 *      - {UUID} package. A package id, as returned from listPackages
 * @param {Function} callback of the form `function (err, body, res)`
 */
CloudApi.prototype.resizeMachine = function resizeMachine(opts, callback) {
    assert.uuid(opts.id, 'opts.id');
    assert.uuid(opts.package, 'opts.package');
    var data = {
        action: 'resize',
        package: opts.package
    };

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        callback(err, body, res);
    });
};

/**
 * rename a machine by id.
 *
 * @param {Object} opts
 *      - id {UUID} Required. The machine id.
 *      - {String} name. The machine name
 * @param {Function} callback of the form `function (err, body, res)`
 */
CloudApi.prototype.renameMachine = function renameMachine(opts, callback) {
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    var data = {
        action: 'rename',
        name: opts.name
    };

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        callback(err, body, res);
    });
};

/**
 * delete a machine by id.
 *
 * @param {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, res)`
 */
CloudApi.prototype.deleteMachine = function deleteMachine(id, callback) {
    var self = this;
    assert.uuid(id, 'id');
    assert.func(callback, 'callback');

    var opts = {
        path: format('/%s/machines/%s', self.account, id),
        method: 'DELETE'
    };
    this._request(opts, function (err, req, res) {
        callback(err, res);
    });
};

/**
 * start a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, res)`
 */
CloudApi.prototype.startMachine = function startMachine(uuid, callback) {
    return this._doMachine('start', uuid, callback);
};

/**
 * stop a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, res)`
 */
CloudApi.prototype.stopMachine = function stopMachine(uuid, callback) {
    return this._doMachine('stop', uuid, callback);
};

/**
 * reboot a machine by id.
 *
 * @param {String} uuid (required) The machine id.
 * @param {Function} callback of the form `function (err, machine, res)`
 */
CloudApi.prototype.rebootMachine = function rebootMachine(uuid, callback) {
    return this._doMachine('reboot', uuid, callback);
};

/**
 * Enables machine firewall.
 *
 * @param {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, null, res)`
 */
CloudApi.prototype.enableMachineFirewall =
function enableMachineFirewall(uuid, callback) {
    return this._doMachine('enable_firewall', uuid, callback);
};

/**
 * Disables machine firewall.
 *
 * @param {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, null, res)`
 */
CloudApi.prototype.disableMachineFirewall =
function disableMachineFirewall(uuid, callback) {
    return this._doMachine('disable_firewall', uuid, callback);
};

/**
 * Enables machine deletion protection.
 *
 * @param {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, null, res)`
 */
CloudApi.prototype.enableMachineDeletionProtection =
function enableMachineDeletionProtection(uuid, callback) {
    return this._doMachine('enable_deletion_protection', uuid, callback);
};

/**
 * Disables machine deletion protection.
 *
 * @param {String} id (required) The machine id.
 * @param {Function} callback of the form `function (err, null, res)`
 */
CloudApi.prototype.disableMachineDeletionProtection =
function disableMachineDeletionProtection(uuid, callback) {
    return this._doMachine('disable_deletion_protection', uuid, callback);
};

/**
 * internal function for start/stop/reboot/enable_firewall/disable_firewall
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
 *      - {Number} waitTimeout (optional) - The number of milliseconds after
 *        which to timeout (call `callback` with a timeout error) waiting.
 *        Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} callback - called when state is reached or on error
 */
CloudApi.prototype.waitForMachineStates =
function waitForMachineStates(opts, callback) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.arrayOfString(opts.states, 'opts.states');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(callback, 'callback');
    var interval = (opts.interval === undefined ? 1000 : opts.interval);
    assert.ok(interval > 0, 'interval must be a positive number');

    poll();
    var startTime = process.hrtime();

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

            if (opts.waitTimeout) {
                var elapsedMs = common.monotonicTimeDiffMs(startTime);
                if (elapsedMs > opts.waitTimeout) {
                    callback(new errors.TimeoutError(format('timeout '
                        + 'waiting for instance %s states %j '
                        + '(elapsed %ds)',
                        opts.id,
                        opts.states,
                        Math.round(elapsedMs / 1000))));
                    return;
                }
            }
            setTimeout(poll, interval);
        });
    }
};

/**
 * List the account's machines.
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListMachines>
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

    function fetch(_fetcharg, limitObj, _datacb, donecb) {
        options.limit = limitObj.limit;
        options.offset = limitObj.offset;
        var endpoint = self._path(
            format('/%s/machines', self.account), options);

        self._request(endpoint, function (err, req, res, body) {
            if (err) {
                donecb(err);
                return;
            }
            var resourcecount = res.headers['x-resource-count'];
            var done = once || resourcecount < options.limit;
            donecb(null, {done: done, results: body});
        });
    }
};

/**
 * List the account's machines.
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListMachines>
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
    assert.optionalArray(options.networks, 'options.networks');
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
 * @param {Function} callback of the form `function (err, audit, res)`
 */
CloudApi.prototype.machineAudit = function machineAudit(id, cb) {
    assert.uuid(id, 'id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/audit', this.account, id);
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Wait for a machine's audit action to finish.
 *
 * @param {Object} options
 *      - {String} id (required) machine id
 *      - {String} action (required) name for the audit action to wait for
 *      - {Number} time (required) the minimum age for the action we are
 *        looking for in milliseconds.
 *      - {Number} interval (optional) - time in ms to poll
 *      - {Number} waitTimeout (optional) - The number of milliseconds after
 *        which to timeout (call `cb` with a timeout error) waiting.
 *        Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} cb callback of the form f(err).
 */
CloudApi.prototype.waitForMachineAudit =
function waitForMachineAudit(opts, cb) {
    var self = this;

    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.action, 'opts.action');
    assert.number(opts.time, 'opts.time');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var interval = opts.interval || 1000;
    assert.ok(interval > 0, 'interval must be a positive number');

    var startTime = process.hrtime();

    function poll() {
        self.machineAudit(opts.id, function auditCB(err, audit) {
            if (err) {
                cb(err);
                return;
            }

            var theRecord = null;
            for (var i = 0; i < audit.length; i++) {
                if (audit[i].action === opts.action &&
                    Date.parse(audit[i].time) > opts.time) {
                    theRecord = audit[i];
                    break;
                }
            }

            if (theRecord) {
                var auditErr;
                if (theRecord.success !== 'yes') {
                    auditErr = new errors.TritonError(format(
                        '%s failed (audit id %s)', opts.action, theRecord.id));
                }
                cb(auditErr);
                return;
            }

            if (opts.waitTimeout) {
                var elapsedMs =
                    common.monotonicTimeDiffMs(startTime);
                if (elapsedMs > opts.waitTimeout) {
                    cb(new errors.TimeoutError(format('timeout '
                        + 'waiting for instance %s %s '
                        + '(elapsed %ds)',
                        opts.id,
                        opts.action,
                        Math.round(elapsedMs / 1000))));
                    return;
                }
            }
            setTimeout(poll, interval);
        });
    }
    poll();
};


/**
 * Wait for a machine's `firewall_enabled` field to go true/false.
 *
 * @param {Object} options
 *      - {String} id: Required. The machine UUID.
 *      - {Boolean} state: Required. The desired `firewall_enabled` state.
 *      - {Number} interval: Optional. Time (in ms) to poll.
 * @param {Function} callback of the form f(err, machine, res).
 */
CloudApi.prototype.waitForMachineFirewallEnabled =
function waitForMachineFirewallEnabled(opts, cb) {
    var self = this;

    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.bool(opts.state, 'opts.state');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(cb, 'cb');

    var interval = opts.interval || 1000;
    assert.ok(interval > 0, 'interval must be a positive number');

    poll();

    function poll() {
        self.getMachine({
            id: opts.id
        }, function (err, machine, res) {
            if (err) {
                cb(err, null, res);
                return;
            }

            if (opts.state === machine.firewall_enabled) {
                cb(null, machine, res);
                return;
            }

            setTimeout(poll, interval);
        });
    }
};



/**
 * Wait for a machine's `deletion_protection` field to go true or
 * false/undefined.
 *
 * @param {Object} options
 *      - {String} id: Required. The machine UUID.
 *      - {Boolean} state: Required. The desired `deletion_protection` state.
 *      - {Number} interval: Optional. Time (in ms) to poll.
 * @param {Function} callback of the form f(err, machine, res).
 */
CloudApi.prototype.waitForDeletionProtectionEnabled =
function waitForDeletionProtectionEnabled(opts, cb) {
    var self = this;

    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.bool(opts.state, 'opts.state');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(cb, 'cb');

    var interval = opts.interval || 1000;
    assert.ok(interval > 0, 'interval must be a positive number');

    poll();

    function poll() {
        self.getMachine({
            id: opts.id
        }, function getMachineCb(err, machine, res) {
            if (err) {
                cb(err, null, res);
                return;
            }

            // !! converts an undefined to a false
            if (opts.state === !!machine.deletion_protection) {
                cb(null, machine, res);
                return;
            }

            setTimeout(poll, interval);
        });
    }
};


// --- machine tags

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListMachineTags>
 *
 * @param {Object} opts:
 *      - @param {UUID} id: The machine UUID.
 * @param {Function} cb - `function (err, tags, res)`
 */
CloudApi.prototype.listMachineTags = function listMachineTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/tags', this.account, opts.id);
    this._passThrough(endpoint, {}, cb);
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetMachineTag>
 *
 * @param {Object} opts:
 *      - @param {UUID} id: The machine UUID. Required.
 *      - @param {UUID} tag: The tag name. Required.
 * @param {Function} cb - `function (err, value, res)`
 *      On success, `value` is the tag value *as a string*. See note above.
 */
CloudApi.prototype.getMachineTag = function getMachineTag(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.tag, 'opts.tag');
    assert.func(cb, 'cb');

    this._request({
        path: format('/%s/machines/%s/tags/%s', this.account, opts.id,
                encodeURIComponent(opts.tag))
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#AddMachineTags>
 *
 * @param {Object} opts:
 *      - @param {UUID} id: The machine UUID. Required.
 *      - @param {Object} tags: The tag name/value pairs.
 * @param {Function} cb - `function (err, tags, res)`
 *      On success, `tags` is the updated set of instance tags.
 */
CloudApi.prototype.addMachineTags = function addMachineTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.object(opts.tags, 'opts.tags');
    assert.func(cb, 'cb');

    // TODO: should this strictly guard on opts.tags types?

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/tags', this.account, opts.id),
        data: opts.tags
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ReplaceMachineTags>
 *
 * @param {Object} opts:
 *      - @param {UUID} id: The machine UUID. Required.
 *      - @param {Object} tags: The tag name/value pairs.
 * @param {Function} cb - `function (err, tags, res)`
 *      On success, `tags` is the updated set of instance tags.
 */
CloudApi.prototype.replaceMachineTags = function replaceMachineTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.object(opts.tags, 'opts.tags');
    assert.func(cb, 'cb');

    // TODO: should this strictly guard on opts.tags types?

    this._request({
        method: 'PUT',
        path: format('/%s/machines/%s/tags', this.account, opts.id),
        data: opts.tags
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteMachineTags>
 *
 * @param {Object} opts:
 *      - @param {UUID} id: The machine UUID. Required.
 * @param {Function} cb - `function (err, res)`
 */
CloudApi.prototype.deleteMachineTags = function deleteMachineTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/tags', this.account, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteMachineTag>
 *
 * @param {Object} opts:
 *      - @param {UUID} id: The machine UUID. Required.
 *      - @param {String} tag: The tag name. Required.
 * @param {Function} cb - `function (err, res)`
 */
CloudApi.prototype.deleteMachineTag = function deleteMachineTag(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.tag, 'opts.tag');
    assert.ok(opts.tag, 'opts.tag cannot be empty');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/tags/%s', this.account, opts.id,
                encodeURIComponent(opts.tag))
    }, function (err, req, res) {
        cb(err, res);
    });
};


// --- snapshots

/**
 * Creates a new snapshot for a given machine.
 *
 * The machine cannot be a KVM brand.
 *
 * Returns a snapshot object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} name (optional) name for new snapshot
 * @param {Function} callback of the form f(err, snapshot, res).
 */
CloudApi.prototype.createMachineSnapshot =
function createMachineSnapshot(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var data = {};
    if (opts.name)
        data.name = opts.name;

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/snapshots', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Wait for a machine's snapshot to go one of a set of specfic states.
 *
 * @param {Object} options
 *      - {String} id {required} machine id
 *      - {String} name (optional) name for new snapshot
 *      - {Array of String} states - desired state
 *      - {Number} interval (optional) - time in ms to poll
 *      - {Number} waitTimeout (optional) - The number of milliseconds after
 *        which to timeout (call `cb` with a timeout error) waiting.
 *        Default is Infinity (i.e. it doesn't timeout).
 * @param {Function} callback of the form f(err, snapshot, res).
 */
CloudApi.prototype.waitForSnapshotStates =
function waitForSnapshotStates(opts, cb) {
    var self = this;

    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.arrayOfString(opts.states, 'opts.states');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var interval = opts.interval || 1000;
    assert.ok(interval > 0, 'interval must be a positive number');

    var startTime = process.hrtime();
    poll();

    function poll() {
        self.getMachineSnapshot({
            id: opts.id,
            name: opts.name
        }, function (err, snapshot, res) {
            if (err) {
                cb(err, null, res);
                return;
            }
            if (opts.states.indexOf(snapshot.state) !== -1) {
                cb(null, snapshot, res);
                return;
            }

            if (opts.waitTimeout) {
                var elapsedMs = common.monotonicTimeDiffMs(startTime);
                if (elapsedMs > opts.waitTimeout) {
                    cb(new errors.TimeoutError(format('timeout '
                        + 'waiting for instance %s snap %s states %j '
                        + '(elapsed %ds)',
                        opts.id,
                        opts.name,
                        opts.states,
                        Math.round(elapsedMs / 1000))));
                    return;
                }
            }
            setTimeout(poll, interval);
        });
    }
};

/**
 * Lists all snapshots for a given machine.
 *
 * Returns a list of snapshot objects.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 * @param {Function} callback of the form f(err, snapshot, res).
 */
CloudApi.prototype.listMachineSnapshots =
function listMachineSnapshots(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/snapshots', this.account, opts.id);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Get a single snapshot for a given machine.
 *
 * Returns a snapshot object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} name (required) the snapshot's name.
 * @param {Function} callback of the form f(err, snapshot, res).
 */
CloudApi.prototype.getMachineSnapshot =
function getMachineSnapshot(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/snapshots/%s', this.account, opts.id,
        encodeURIComponent(opts.name));
    this._passThrough(endpoint, opts, cb);
};

/**
 * Re/boots a machine from a snapshot.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} name (required) the snapshot's name.
 * @param {Function} callback of the form f(err, res).
 */
CloudApi.prototype.startMachineFromSnapshot =
function startMachineFromSnapshot(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/snapshots/%s', this.account, opts.id,
            encodeURIComponent(opts.name)),
        data: opts
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Deletes a machine snapshot.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} name (required) the snapshot's name.
 * @param {Function} callback of the form f(err, res).
 */
CloudApi.prototype.deleteMachineSnapshot =
function deleteMachineSnapshot(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/snapshots/%s', this.account, opts.id,
            encodeURIComponent(opts.name))
    }, function (err, req, res) {
        cb(err, res);
    });
};

// --- metadatas

/**
 * Updates a new metadata for a given machine.
 *
 * Returns a metadata object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} name (optional) name for new metadata
 * @param {Function} callback of the form f(err, metadata, res).
 */
CloudApi.prototype.updateMachineMetadata =
function updateMachineMetadata(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.object(opts.metas, 'opts.metas');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/metadata', this.account, opts.id),
        data: opts.metas
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Lists all metadatas for a given machine.
 *
 * Returns a list of metadata objects.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 * @param {Function} callback of the form f(err, metadata, res).
 */
CloudApi.prototype.listMachineMetadatas =
function listMachineMetadatas(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/metadata', this.account, opts.id);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Get a single metadata for a given machine.
 *
 * Returns a metadata object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} name (required) the metadata's name.
 * @param {Function} callback of the form f(err, metadata, res).
 */
CloudApi.prototype.getMachineMetadata =
function getMachineMetadata(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/metadata/%s',
        this.account, opts.id, opts.name);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Deletes a machine metadata.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} key(required).
 * @param {Function} callback of the form f(err, res).
 */
CloudApi.prototype.deleteMachineMetadata =
function deleteMachineMetadata(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.key, 'opts.key');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/metadata/%s',
            this.account, opts.id, opts.key)
    }, function (err, req, res) {
        cb(err, res);
    });
};

/**
 * DeleteAll a machine metadata.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 * @param {Function} callback of the form f(err, res).
 */
CloudApi.prototype.deleteAllMachineMetadata =
function deleteAllMachineMetadata(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/metadata', this.account, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};


// --- migrations

/**
 * Performs a migration action for a given machine.
 *
 * Returns a migration object.
 *
 *      - {String} id (required) the machine's id.
 *      - {String} action (required) the action to be performed. Supported
 *        actions are 'begin', 'sync', 'pause', 'abort', 'automatic' and
 *        'switch'.
 *      - {String} affinity (optional) affinity rules for the migration
 *        (only when the action is 'begin')
 * @param {Function} callback of the form f(err, migration, res).
 */
CloudApi.prototype.machineMigration =
function machineMigration(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.action, 'opts.action');
    assert.optionalArrayOfString(opts.affinity, 'opts.affinity');
    assert.func(cb, 'cb');

    var actions = ['begin', 'sync', 'pause', 'switch', 'automatic', 'abort',
        'finalize'];

    if (actions.indexOf(opts.action) === -1) {
        cb(new errors.TritonError('Unsupported migration action ' +
                    opts.action));
        return;
    }

    var data = {
        action: opts.action
    };

    if (opts.affinity) {
        if (opts.action !== 'begin' && opts.action !== 'automatic') {
            cb(new errors.TritonError('Cannot set affinity for action ' +
                        opts.action));
            return;
        }
        data.affinity = opts.affinity;
    }


    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/migrate', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};



/**
 * Lists all migrations for a given account.
 *
 * Returns a list of migration objects.
 *
 * @param {Function} callback of the form f(err, migrations, res).
 */
CloudApi.prototype.listMigrations =
function listMigrations(cb) {
    assert.func(cb, 'cb');

    var endpoint = format('/%s/migrations', this.account);
    this._passThrough(endpoint, cb);
};



/**
 * Returns a single migration object.
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetMigration>
 *
 * @param {Object} opts
 *      - id {UUID|String} Machine ID (a UUID).
 * @param {Function} cb of the form `function (err, migration, res)`
 */
CloudApi.prototype.getMigration = function getMigration(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = this._path(
        format('/%s/migrations/%s', this.account, opts.id));
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};

// --- NICs

/**
 * Adds a NIC on a network to an instance.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the instance id.
 *      - {String|Object} (required) network uuid or network object.
 * @param {Function} callback of the form f(err, nic, res).
 */
CloudApi.prototype.addNic =
function addNic(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.ok(opts.network, 'opts.network');

    var data = {
        network: opts.network,
        primary: opts.primary
    };

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/nics', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Lists all NICs on an instance.
 *
 * Returns an array of objects.
 *
 * @param opts {Object} Options
 *      - {String} id (required) the instance id.
 * @param {Function} callback of the form f(err, nics, res).
 */
CloudApi.prototype.listNics =
function listNics(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/nics', this.account, opts.id);
    this._passThrough(endpoint, opts, cb);
};


/**
 * Retrieves a NIC on an instance.
 *
 * @param {Object} options object containing:
 *      - {UUID} id: The instance id. Required.
 *      - {String} mac: The NIC's MAC. Required.
 * @param {Function} callback of the form `function (err, nic, res)`
 */
CloudApi.prototype.getNic =
function getNic(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.mac, 'opts.mac');
    assert.func(cb, 'cb');

    var mac = opts.mac.replace(/:/g, '');
    var endpoint = format('/%s/machines/%s/nics/%s', this.account, opts.id,
                          mac);
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Remove a NIC off an instance.
 *
 * @param {Object} opts (object)
 *      - {UUID} id: The instance id. Required.
 *      - {String} mac: The NIC's MAC. Required.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.removeNic =
function removeNic(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.mac, 'opts.mac');
    assert.func(cb, 'cb');

    var mac = opts.mac.replace(/:/g, '');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/nics/%s', this.account, opts.id, mac)
    }, function (err, req, res) {
        cb(err, res);
    });
};


/**
 * Wait for a machine's nic to go one of a set of specfic states.
 *
 * @param {Object} options
 *      - {String} id {required} machine id
 *      - {String} mac {required} mac for new nic
 *      - {Array of String} states - desired state
 *      - {Number} interval (optional) - time in ms to poll
 * @param {Function} callback of the form f(err, nic, res).
 */
CloudApi.prototype.waitForNicStates =
function waitForNicStates(opts, cb) {
    var self = this;

    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.mac, 'opts.mac');
    assert.arrayOfString(opts.states, 'opts.states');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(cb, 'cb');

    var interval = opts.interval || 1000;
    assert.ok(interval > 0, 'interval must be a positive number');

    poll();

    function poll() {
        self.getNic({
            id: opts.id,
            mac: opts.mac
        }, function onPoll(err, nic, res) {
            if (err) {
                cb(err, null, res);
                return;
            }
            if (opts.states.indexOf(nic.state) !== -1) {
                cb(null, nic, res);
                return;
            }
            setTimeout(poll, interval);
        });
    }
};


// --- firewall rules

/**
 * Creates a Firewall Rule.
 *
 * @param {Object} options object containing:
 *      - {String} rule (required) the fwrule text.
 *      - {Boolean} enabled (optional) default to false.
 *      - {Boolean} log (optional) default to false.
 *      - {String} description (optional)
 * @param {Function} callback of the form f(err, fwrule, res).
 */
CloudApi.prototype.createFirewallRule =
function createFirewallRule(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.rule, 'opts.rule');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalBool(opts.enabled, 'opts.enabled');
    assert.optionalBool(opts.log, 'opts.log');

    var data = {};
    Object.keys(this.UPDATE_FWRULE_FIELDS).forEach(function (attr) {
        if (opts[attr] !== undefined)
            data[attr] = opts[attr];
    });

    this._request({
        method: 'POST',
        path: format('/%s/fwrules', this.account),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Lists all your Firewall Rules.
 *
 * Returns an array of objects.
 *
 * @param opts {Object} Options
 * @param {Function} callback of the form f(err, fwrules, res).
 */
CloudApi.prototype.listFirewallRules =
function listFirewallRules(opts, cb) {
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/fwrules', this.account);
    this._passThrough(endpoint, opts, cb);
};


/**
 * Retrieves a Firewall Rule.
 *
 * @param {UUID} id: The firewall rule id.
 * @param {Function} callback of the form `function (err, fwrule, res)`
 */
CloudApi.prototype.getFirewallRule =
function getFirewallRule(id, cb) {
    assert.uuid(id, 'id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/fwrules/%s', this.account, id);
    this._request(endpoint, function (err, req, res, body) {
        cb(err, body, res);
    });
};


// <updatable account field> -> <expected typeof>
CloudApi.prototype.UPDATE_FWRULE_FIELDS = {
    enabled: 'boolean',
    log: 'boolean',
    rule: 'string',
    description: 'string'
};


/**
 * Updates a Firewall Rule.
 *
 * Dev Note: That 'rule' is *required* here is lame. Hoping to change that
 * in cloudapi.
 *
 * @param {Object} opts object containing:
 *      - {UUID} id: The fwrule id. Required.
 *      - {String} rule: The fwrule text. Required.
 *      - {Boolean} enabled: Optional.
 *      - {Boolean} log: Optional.
 *      - {String} description: Description of the rule. Optional.
 * @param {Function} callback of the form `function (err, fwrule, res)`
 */
CloudApi.prototype.updateFirewallRule =
function updateFirewallRule(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.string(opts.rule, 'opts.rule');
    assert.optionalBool(opts.enabled, 'opts.enabled');
    assert.optionalBool(opts.log, 'opts.log');
    assert.optionalString(opts.description, 'opts.description');
    assert.func(cb, 'cb');

    var data = {};
    Object.keys(this.UPDATE_FWRULE_FIELDS).forEach(function (attr) {
        if (opts[attr] !== undefined)
            data[attr] = opts[attr];
    });

    this._request({
        method: 'POST',
        path: format('/%s/fwrules/%s', this.account, opts.id),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Enable a Firewall Rule.
 *
 * @param {Object} opts
 *      - {UUID} id: The firewall id. Required.
 * @param {Function} callback of the form `function (err, fwrule, res)`
 */
CloudApi.prototype.enableFirewallRule =
function enableFirewallRule(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/fwrules/%s/enable', this.account, opts.id),
        data: {}
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Disable a Firewall Rule.
 *
 * @param {Object} opts
 *      - {UUID} id: The firewall id. Required.
 * @param {Function} callback of the form `function (err, fwrule, res)`
 */
CloudApi.prototype.disableFirewallRule =
function disableFirewallRule(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/fwrules/%s/disable', this.account, opts.id),
        data: {}
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Remove a Firewall Rule.
 *
 * @param {Object} opts (object)
 *      - {UUID} id: The firewall id. Required.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.deleteFirewallRule =
function deleteFirewallRule(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/fwrules/%s', this.account, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};


/**
 * Lists all the Firewall Rules affecting a given machine.
 *
 * Returns an array of firewall objects.
 *
 * @param opts {Object} Options
 *      - {String} id (required) machine id.
 * @param {Function} callback of the form f(err, fwrules, res).
 */
CloudApi.prototype.listMachineFirewallRules =
function listMachineFirewallRules(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/fwrules', this.account, opts.id);
    this._passThrough(endpoint, opts, cb);
};


/**
 * Lists all the Machines affected by the given firewall rule.
 *
 * Returns an array of machine objects.
 *
 * @param opts {Object} Options
 *      - {String} id (required) firewall rule.
 * @param {Function} callback of the form f(err, machines, res).
 */
CloudApi.prototype.listFirewallRuleMachines =
function listFirewallRuleMachines(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/fwrules/%s/machines', this.account, opts.id);
    this._passThrough(endpoint, opts, cb);
};


// --- rbac

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListUsers>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetUser>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#CreateUser>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#UpdateUser>
 *
 * @param {Object} opts (object) user object containing:
 *      - {String} id (required) for your user. This can be either the user
 *        login, or the user id (UUID)
 *      - {String} login (optional)
 *      - {String} email (optional)
 *      - {String} companyName (optional)
 *      - {String} firstName (optional)
 *      - {String} lastName (optional)
 *      - {String} address (optional)
 *      - {String} postalCode (optional)
 *      - {String} city (optional)
 *      - {String} state (optional)
 *      - {String} country (optional)
 *      - {String} phone (optional)
 * @param {Function} cb of the form `function (err, user, res)`
 */
CloudApi.prototype.updateUser = function updateUser(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var update = {
        login: opts.login,
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteUser>
 *
 * @param {Object} opts (object)
 *      - {String} id (required) for your user.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.deleteUser = function deleteUser(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/users/%s', this.account, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};



/**
 * List RBAC user's SSH keys.
 *
 * @param {Object} opts (object)
 *      - {String} userId (required) The user id or login.
 * @param {Function} callback of the form `function (err, userKeys, res)`
 */
CloudApi.prototype.listUserKeys = function listUserKeys(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.userId, 'opts.userId');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/users/%s/keys', this.account, opts.userId);
    this._passThrough(endpoint, {}, cb);
};


/**
 * Get a RBAC user's SSH key.
 *
 * @param {Object} opts (object)
 *      - {String} userId (required) The user id or login.
 *      - {String} fingerprint (required*) The SSH key fingerprint. One of
 *        'fingerprint' or 'name' is required.
 *      - {String} name (required*) The SSH key name. One of 'fingerprint'
 *        or 'name' is required.
 * @param {Function} callback of the form `function (err, userKey, res)`
 */
CloudApi.prototype.getUserKey = function getUserKey(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.userId, 'opts.userId');
    assert.optionalString(opts.fingerprint, 'opts.fingerprint');
    assert.optionalString(opts.name, 'opts.name');
    assert.ok(opts.fingerprint || opts.name,
        'one of "fingerprint" or "name" is required');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/users/%s/keys/%s', this.account, opts.userId,
        encodeURIComponent(opts.fingerprint || opts.name));
    this._passThrough(endpoint, {}, cb);
};


/**
 * Create/upload a new RBAC user SSH public key.
 *
 * @param {Object} opts (object)
 *      - {String} userId (required) The user id or login.
 *      - {String} key (required) The SSH public key content.
 *      - {String} name (optional) A name for the key. If not given, the
 *        key fingerprint will be used.
 * @param {Function} callback of the form `function (err, userKey, res)`
 */
CloudApi.prototype.createUserKey = function createUserKey(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.userId, 'opts.userId');
    assert.string(opts.key, 'opts.key');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');

    var data = {
        name: opts.name,
        key: opts.key
    };

    this._request({
        method: 'POST',
        path: format('/%s/users/%s/keys', this.account, opts.userId),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * Delete a RBAC user's SSH key.
 *
 * @param {Object} opts (object)
 *      - {String} userId (required) The user id or login.
 *      - {String} fingerprint (required*) The SSH key fingerprint. One of
 *        'fingerprint' or 'name' is required.
 *      - {String} name (required*) The SSH key name. One of 'fingerprint'
 *        or 'name' is required.
 * @param {Function} callback of the form `function (err, res)`
 */
CloudApi.prototype.deleteUserKey = function deleteUserKey(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.userId, 'opts.userId');
    assert.optionalString(opts.fingerprint, 'opts.fingerprint');
    assert.optionalString(opts.name, 'opts.name');
    assert.ok(opts.fingerprint || opts.name,
        'one of "fingerprint" or "name" is required');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/users/%s/keys/%s', this.account, opts.userId,
            encodeURIComponent(opts.fingerprint || opts.name))
    }, function (err, req, res) {
        cb(err, res);
    });
};


/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListRoles>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetRole>
 *
 * @param {Object} opts
 *      - id {UUID|String} The role ID or name.
 * @param {Function} callback of the form `function (err, role, res)`
 */
CloudApi.prototype.getRole = function getRole(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/roles/%s', this.account, opts.id);
    this._passThrough(endpoint, {}, cb);
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#CreateRole>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#UpdateRole>
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
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeleteRole>
 *
 * @param {Object} opts (object)
 *      - {String} id (required) of the role to delete.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.deleteRole = function deleteRole(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/roles/%s', this.account, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};


/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#ListPolicies>
 *
 * @param opts {Object} Options (optional)
 * @param cb {Function} Callback of the form `function (err, policies, res)`
 */
CloudApi.prototype.listPolicies = function listPolicies(opts, cb) {
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.func(cb, 'cb');
    assert.object(opts, 'opts');

    var endpoint = format('/%s/policies', this.account);
    this._passThrough(endpoint, opts, cb);
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#GetPolicy>
 *
 * @param {Object} opts
 *      - id {UUID|String} The policy ID or name.
 * @param {Function} callback of the form `function (err, policy, res)`
 */
CloudApi.prototype.getPolicy = function getPolicy(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/policies/%s', this.account, opts.id);
    this._passThrough(endpoint, {}, cb);
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#CreatePolicy>
 *
 * @param {Object} opts (object) policy object containing:
 *      - {String} name (required) for the policy.
 *      - {Array} description (optional) for the policy.
 *      - {Array} rules (optional) for the policy.
 * @param {Function} cb of the form `function (err, policy, res)`
 */
CloudApi.prototype.createPolicy = function createPolicy(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.name, 'opts.name');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var data = {
        name: opts.name,
        description: opts.description,
        rules: opts.rules
    };

    this._request({
        method: 'POST',
        path: format('/%s/policies', this.account),
        data: data
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#UpdatePolicy>
 *
 * @param {Object} opts (object) policy object containing:
 *      - {UUID|String} id (required) The policy ID or name.
 *      - {String} name (optional)
 *      - {String} description (optional)
 *      - {Array} rules (optional)
 * @param {Function} cb of the form `function (err, policy, res)`
 */
CloudApi.prototype.updatePolicy = function updatePolicy(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    // XXX strict on inputs
    assert.func(cb, 'cb');

    var update = {
        name: opts.name,
        description: opts.description,
        rules: opts.rules
    };

    this._request({
        method: 'POST',
        path: format('/%s/policies/%s', this.account, opts.id),
        data: update
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};


/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#DeletePolicy>
 *
 * @param {Object} opts (object) user object containing:
 *      - {String} id (required) of the policy to delete.
 * @param {Function} cb of the form `function (err, res)`
 */
CloudApi.prototype.deletePolicy = function deletePolicy(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/policies/%s', this.account, opts.id)
    }, function (err, req, res) {
        cb(err, res);
    });
};


// ---- RBAC role tag support functions

/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#role-tags>
 * Get RBAC role-tags on a resource. Technically there isn't a separate
 * specific API endpoint for this -- it is the Get$Resource endpoint instead.
 *
 * @param {Object} opts:
 *      - {String} resource (required) The resource URL. E.g.
 *        '/:account/machines/:uuid' to tag a particular machine instance.
 * @param {Function} cb of the form `function (err, roleTags, resource, res)`
 * @throws {AssertionError, TypeError} on invalid inputs
 */
CloudApi.prototype.getRoleTags = function getRoleTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.resource, 'opts.resource');
    assert.func(cb, 'cb');

    // Validate `resource`.
    // TODO: share this validation with `setRoleTags`.
    var resourceRe = new RegExp('^/[^/]{2,}/[^/]+');
    if (!resourceRe.test(opts.resource)) {
        throw new TypeError(format('invalid resource "%s": must match ' +
            '"/:account/:type..."', opts.resource));
    }

    var validResources = [
        'machines',
        'packages',
        'images',
        'fwrules',
        'networks',
        // TODO: validate/test role tags on these rbac resources
        'users',
        'roles',
        'policies',
        // TODO: validate, test
        'keys',
        'datacenters'
    ];
    var parts = opts.resource.split('/');
    if (validResources.indexOf(parts[2]) === -1) {
        throw new TypeError(format('invalid resource "%s": resource type ' +
            'must be one of: %s', opts.resource, validResources.join(', ')));
    }

    function roleTagsFromRes(res) {
        return (
            (res.headers['role-tag'] || '')
            /* JSSTYLED */
            .split(/\s*,\s*/)
            .filter(function (r) { return r.trim(); })
        );
    }

    this._request({
        /*
         * We use GET instead of HEAD to also be able to return the
         * resource JSON. Technically we *could* drop support for that from
         * this API, but `tritonapi.js` is using it.
         */
        method: 'GET',
        path: opts.resource
    }, function (err, req, res, body) {
        if (err) {
            cb(err, null, res);
            return;
        }

        var roleTags = roleTagsFromRes(res);
        cb(err, roleTags, body, res);
    });
};


/**
 * <http://apidocs.tritondatacenter.com/cloudapi/#SetRoleTags>
 * Set RBAC role-tags on a resource.
 *
 * @param {Object} opts (object):
 *      - {String} resource (required) The resource URL. E.g.
 *        '/:account/machines/:uuid' to tag a particular machine instance.
 *      - {Array} roleTags (required) the array of role tags to set. Each
 *        role tag string is the name of a RBAC role. See `ListRoles`.
 * @param {Function} cb of the form `function (err, body, res)`
 *      Where `body` is of the form `{name: <resource url>,
 *      'role-tag': <array of added role tags>}`.
 * @throws {AssertionError, TypeError} on invalid inputs
 */
CloudApi.prototype.setRoleTags = function setRoleTags(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.resource, 'opts.resource');
    assert.arrayOfString(opts.roleTags, 'opts.roleTags');
    assert.func(cb, 'cb');

    // Validate `resource`.
    var resourceRe = new RegExp('^/[^/]{2,}/[^/]+');
    if (!resourceRe.test(opts.resource)) {
        throw new TypeError(format('invalid resource "%s": must match ' +
            '"/:account/:type..."', opts.resource));
    }

    var validResources = [
        'machines',
        'packages',
        'images',
        'fwrules',
        'networks',
        // TODO: validate/test role tags on these rbac resources
        'users',
        'roles',
        'policies',
        // TODO: validate, test
        'keys',
        'datacenters'
    ];
    var parts = opts.resource.split('/');
    if (validResources.indexOf(parts[2]) === -1) {
        throw new TypeError(format('invalid resource "%s": resource type ' +
            'must be one of: %s', opts.resource, validResources.join(', ')));
    }

    this._request({
        method: 'PUT',
        path: opts.resource,
        data: {
            'role-tag': opts.roleTags
        }
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Get a volume by id.
 *
 * @param {Object} opts
 *      - id {UUID} Required. The volume id.
 * @param {Function} cb of the form `function (err, volume, res)`
 */
CloudApi.prototype.getVolume = function getVolume(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');

    var endpoint = format('/%s/volumes/%s', this.account, opts.id);
    this._passThrough(endpoint, cb);
};

/**
 * List the account's volumes.
 *
 * @param {Object} options
 * @param {Function} callback - called like `function (err, volumes)`
 */
CloudApi.prototype.listVolumes = function listVolumes(options, cb) {
    var endpoint = format('/%s/volumes', this.account);
    this._passThrough(endpoint, options, cb);
};

/**
 * List the account's volume sizes.
 *
 * @param {Object} options
 * @param {Function} callback - called like `function (err, volumeSizes)`
 */
CloudApi.prototype.listVolumeSizes = function listVolumeSizes(options, cb) {
    var endpoint = format('/%s/volumesizes', this.account);
    this._passThrough(endpoint, options, cb);
};

/**
 * Create a volume for the account.
 *
 * @param {Object} options
 *      - name {String} Optional: the name of the volume to be created
 *      - size {Number} Optional: a number representing the size of the volume
 *        to be created in mebibytes.
 *      - networks {Array} Optional: an array that contains the uuids of all the
 *        networks that should be reachable from the newly created volume
 *      - type {String}: the type of the volume. Currently, only "tritonnfs" is
 *        supported.
 *      - affinity {Array of String}: Optional affinity rules.
 *      - tags {Object}: Optional tag name/value pairs.
 * @param {Function} callback - called like `function (err, volume, res)`
 */
CloudApi.prototype.createVolume = function createVolume(options, cb) {
    assert.object(options, 'options');
    assert.optionalString(options.name, 'options.name');
    assert.optionalNumber(options.size, 'options.size');
    assert.optionalArrayOfUuid(options.networks, 'options.networks');
    assert.string(options.type, 'options.type');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/volumes', this.account),
        data: {
            affinity: options.affinity,
            name: options.name,
            size: options.size,
            tags: options.tags,
            networks: (options.networks ? options.networks : undefined),
            type: options.type
        }
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Delete an account's volume.
 *
 * @param {String} volumeUuid
 * @param {Function} callback - called like `function (err, volume, res)`
 */
CloudApi.prototype.deleteVolume = function deleteVolume(volumeUuid, cb) {
    assert.uuid(volumeUuid, 'volumeUuid');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/volumes/%s', this.account, volumeUuid)
    }, function (err, req, res, _body) {
        cb(err, res);
    });
};


/**
 * Wait for a volume to go one of a set of specfic states.
 *
 * @param {Object} options
 *      - {String} id - machine UUID
 *      - {Array of String} states - desired state
 *      - {Number} interval (optional) - time in ms to poll
 *      - {Number} timeout (optional) - time in ms after which "callback" is
 *        called with an error object if the volume hasn't yet transitioned to
 *        one of the states in "opts.states".
 * @param {Function} callback - called when state is reached or on error
 */
CloudApi.prototype.waitForVolumeStates =
function waitForVolumeStates(opts, callback) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.arrayOfString(opts.states, 'opts.states');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.optionalNumber(opts.timeout, 'opts.timeout');
    assert.func(callback, 'callback');

    var interval = (opts.interval === undefined ? 1000 : opts.interval);
    if (opts.timeout !== undefined) {
        interval = Math.min(interval, opts.timeout);
    }
    assert.ok(interval > 0, 'interval must be a positive number');

    var startTime = process.hrtime();
    var timeout = opts.timeout;

    poll();

    function poll() {
        self.getVolume({
            id: opts.id
        }, function (err, vol, res) {
            var elapsedTime;
            var timedOut = false;

            if (err) {
                callback(err, null, res);
                return;
            }
            if (opts.states.indexOf(vol.state) !== -1) {
                callback(null, vol, res);
                return;
            } else {
                if (timeout !== undefined) {
                    elapsedTime = common.monotonicTimeDiffMs(startTime);
                    if (elapsedTime > timeout) {
                        timedOut = true;
                    }
                }

                if (timedOut) {
                    callback(new errors.TimeoutError(format('timeout waiting '
                        + 'for state changes on volume %s (elapsed %ds)',
                        opts.id, Math.round(elapsedTime / 1000))));
                    return;
                } else {
                    setTimeout(poll, interval);
                    return;
                }
            }
        });
    }
};

// --- Disks

/**
 * List disks for a given machine.
 *
 * Returns an array of disk objects.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 * @param {Function} callback of the form f(err, body, res).
 */
CloudApi.prototype.listMachineDisks =
function listMachineDisks(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/disks', this.account, opts.id);
    this._passThrough(endpoint, opts, cb);
};

/**
 * Get a single disk for a given machine.
 *
 * Returns a disk object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} diskId (required) the disk's ID
 * @param {Function} callback of the form f(err, body, res).
 */
CloudApi.prototype.getMachineDisk =
function getMachineDisk(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.uuid(opts.diskId, 'opts.diskId');
    assert.func(cb, 'cb');

    var endpoint = format('/%s/machines/%s/disks/%s', this.account, opts.id,
        encodeURIComponent(opts.diskId));
    this._passThrough(endpoint, opts, cb);
};

/**
 * Create a new disk for a given machine.
 *
 * Returns a disk object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String or Number} size (required) in MiB or the string "remaining"
 *        to use up all remaining available space
 * @param {Function} callback of the form f(err, body, res).
 */
CloudApi.prototype.createMachineDisk =
function createMachineDisk(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.ok(opts.size, 'opts.size');
    if (opts.size !== 'remaining') {
        assert.number(opts.size, 'opts.size');
        assert.ok(opts.size > 0, 'opts.size > 0');
    }
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/disks', this.account, opts.id),
        data: {size: opts.size}
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Delete a disk for a given machine.
 *
 * Returns a disk object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} diskId (required) the disk id.
 * @param {Function} callback of the form f(err, body, res).
 */
CloudApi.prototype.deleteMachineDisk =
function deleteMachineDisk(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.uuid(opts.diskId, 'opts.diskId');
    assert.func(cb, 'cb');

    this._request({
        method: 'DELETE',
        path: format('/%s/machines/%s/disks/%s', this.account, opts.id,
                     opts.diskId)
    }, function (err, req, res, _body) {
        cb(err, res);
    });
};

/**
 * Resize a disk for a given machine.
 *
 * Returns a disk object.
 *
 * @param {Object} options object containing:
 *      - {String} id (required) the machine's id.
 *      - {String} diskId (required) the disk id.
 *      - {Number} size (required) in MiB
 *      - {Boolean} dangerousAllowShrink (optional), whether a disk can be
 *        shrunk.
 * @param {Function} callback of the form f(err, body, res).
 */
CloudApi.prototype.resizeMachineDisk =
function resizeMachineDisk(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.uuid(opts.diskId, 'opts.diskId');
    assert.number(opts.size, 'opts.size');
    assert.ok(opts.size > 0, 'opts.size > 0');
    assert.optionalBool(opts.dangerousAllowShrink, 'opts.dangerousAllowShrink');
    assert.func(cb, 'cb');

    this._request({
        method: 'POST',
        path: format('/%s/machines/%s/disks/%s', this.account, opts.id,
                     opts.diskId),
        data: {
            size: opts.size,
            dangerous_allow_shrink: opts.dangerousAllowShrink
        }
    }, function (err, req, res, body) {
        cb(err, body, res);
    });
};

/**
 * Wait for a disk to be created
 *
 * @param {Object} options
 *      - {String} id - machine UUID
 *      - {Array of Object} disks - the disks prior to disk creation
 *      - {String or Number} size - final size of disk in MiB or "remaining"
 *      - {Number} interval (optional) - time in ms to poll
 *      - {Number} waitTimeout (optional) - time in seconds to wait before
 *        failing with an exception.
 * @param {Function} cb - called when disk is created or on error
 */
CloudApi.prototype.waitForDiskCreate =
function waitForDiskCreate(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.arrayOfObject(opts.disks, 'opts.disks');
    assert.ok(opts.size, 'opts.size');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(cb, 'cb');

    var interval = (opts.interval === undefined ? 1000 : opts.interval);
    assert.ok(interval > 0, 'interval must be a positive number');

    var oldDiskIds = opts.disks.map(function toIds(disk) {
        return disk.id;
    });

    var startTime = process.hrtime();

    function checkAdd(oldDisks, newDisks, size) {
        if (newDisks.length > oldDisks.length) {
            return newDisks.filter(function getAdd(disk) {
                return oldDiskIds.indexOf(disk.id) === -1 &&
                    disk.state !== 'creating' &&
                    disk.size === size;
            });
        } else {
            return [];
        }
    }

    poll();

    function poll() {
        self.listMachineDisks({id: opts.id}, function onDisks(err, disks) {
            if (err) {
                cb(err);
                return;
            }

            var newDisks = checkAdd(oldDiskIds, disks, opts.size);

            if (newDisks.length === 0) {
                if (opts.waitTimeout) {
                    var elapsedMs =
                        common.monotonicTimeDiffMs(startTime);
                    if (elapsedMs > opts.waitTimeout) {
                        cb(new errors.TimeoutError(format('timeout '
                            + 'waiting for disk %s addition '
                            + '(elapsed %ds)',
                            opts.id,
                            Math.round(elapsedMs / 1000))));
                        return;
                    }
                }

                setTimeout(poll, interval);
            } else if (newDisks.length === 1) {
                cb(null, newDisks[0]);
            } else if (newDisks.length > 1) {
                cb(new Error('Multiple new disks were detected while ' +
                    'waiting for disk add to complete.'));
            }
        });
    }
};

/**
 * Wait for a disk to be deleted
 *
 * @param {Object} options
 *      - {String} id - machine UUID
 *      - {String} diskId - diskId
 *      - {Number} interval (optional) - time in ms to poll
 *      - {Number} waitTimeout (optional) - time in seconds to wait before
 *        failing with an exception.
 * @param {Function} cb - called when disk is deleted or on error
 */
CloudApi.prototype.waitForDiskDelete =
function waitForDiskDelete(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.uuid(opts.diskId, 'opts.diskId');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.func(cb, 'cb');

    var interval = (opts.interval === undefined ? 1000 : opts.interval);
    assert.ok(interval > 0, 'interval must be a positive number');
    var startTime = process.hrtime();

    poll();

    function poll() {
        self.getMachineDisk({
            id: opts.id,
            diskId: opts.diskId
        }, function onDisk(err, _disk, _res) {
            if (err && err.name === 'ResourceNotFoundError') {
                cb();
                return;
            }

            if (err) {
                cb(err);
                return;
            }

            if (opts.waitTimeout) {
                var elapsedMs =
                    common.monotonicTimeDiffMs(startTime);
                if (elapsedMs > opts.waitTimeout) {
                    cb(new errors.TimeoutError(format('timeout '
                        + 'waiting for disk %s deletion '
                        + '(elapsed %ds)',
                        opts.id,
                        Math.round(elapsedMs / 1000))));
                    return;
                }
            }
            setTimeout(poll, interval);
        });
    }
};

/**
 * Wait for a disk to resize.
 *
 * @param {Object} options
 *      - {String} id - machine UUID
 *      - {String} diskId - diskId
 *      - {String or Number} size - final size of disk in MiB or "remaining"
 *      - {Number} interval (optional) - time in ms to poll
 *      - {Number} waitTimeout (optional) - time in seconds to wait before
 *        failing with an exception.
 * @param {Function} cb - called when disk is resized or on error
 */
CloudApi.prototype.waitForDiskResize =
function waitForDiskResize(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.id, 'opts.id');
    assert.uuid(opts.diskId, 'opts.diskId');
    assert.number(opts.size, 'opts.size');
    assert.optionalNumber(opts.waitTimeout, 'opts.waitTimeout');
    assert.optionalNumber(opts.interval, 'opts.interval');
    assert.func(cb, 'cb');

    var interval = (opts.interval === undefined ? 1000 : opts.interval);
    assert.ok(interval > 0, 'interval must be a positive number');
    var startTime = process.hrtime();

    poll();

    function poll() {
        self.getMachineDisk({
            id: opts.id,
            diskId: opts.diskId
        }, function onDisk(err, disk, res) {
            if (err) {
                cb(err, null, res);
                return;
            }

            if (disk.size === opts.size && disk.state !== 'resizing') {
                cb(null, disk);
            } else {
                if (opts.waitTimeout) {
                    var elapsedMs =
                        common.monotonicTimeDiffMs(startTime);
                    if (elapsedMs > opts.waitTimeout) {
                        cb(new errors.TimeoutError(format('timeout '
                            + 'waiting for disk %s resize '
                            + '(elapsed %ds)',
                            opts.id,
                            Math.round(elapsedMs / 1000))));
                        return;
                    }
                }
                setTimeout(poll, interval);
            }
        });
    }
};

// --- Exports

module.exports = {
    createClient: function createClient(options) {
        return new CloudApi(options);
    },

    CloudApi: CloudApi
};
