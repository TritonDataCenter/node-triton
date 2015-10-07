/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * Error classes that the joyent CLI may produce.
 */

var util = require('util'),
    format = util.format;
var assert = require('assert-plus');
var verror = require('verror'),
    VError = verror.VError,
    WError = verror.WError;



// ---- error classes

/**
 * Base error. Instances will always have a string `message` and
 * a string `code` (a CamelCase string).
 */
function _TritonBaseVError(options) {
    assert.object(options, 'options');
    assert.string(options.message, 'options.message');
    assert.optionalString(options.code, 'options.code');
    assert.optionalObject(options.cause, 'options.cause');
    assert.optionalNumber(options.statusCode, 'options.statusCode');
    var self = this;

    var args = [];
    if (options.cause) args.push(options.cause);
    args.push(options.message);
    VError.apply(this, args);

    var extra = Object.keys(options).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = options[k];
    });
}
util.inherits(_TritonBaseVError, VError);

/*
 * Base error class that doesn't include a 'cause' message in its message.
 * This is useful in cases where we are wrapping CloudAPI errors with
 * onces that should *replace* the CloudAPI error message.
 */
function _TritonBaseWError(options) {
    assert.object(options, 'options');
    assert.string(options.message, 'options.message');
    assert.optionalString(options.code, 'options.code');
    assert.optionalObject(options.cause, 'options.cause');
    assert.optionalNumber(options.statusCode, 'options.statusCode');
    var self = this;

    var args = [];
    if (options.cause) args.push(options.cause);
    args.push(options.message);
    WError.apply(this, args);

    var extra = Object.keys(options).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = options[k];
    });
}
util.inherits(_TritonBaseWError, WError);

/*
 * A generic (i.e. a cop out) code-less error.
 */
function TritonError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    _TritonBaseVError.call(this, {
        cause: cause,
        message: message,
        exitStatus: 1
    });
}
util.inherits(TritonError, _TritonBaseVError);


function InternalError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    _TritonBaseVError.call(this, {
        cause: cause,
        message: message,
        code: 'InternalError',
        exitStatus: 1
    });
}
util.inherits(InternalError, _TritonBaseVError);


/**
 * CLI usage error
 */
function ConfigError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    _TritonBaseVError.call(this, {
        cause: cause,
        message: message,
        code: 'Config',
        exitStatus: 1
    });
}
util.inherits(ConfigError, _TritonBaseVError);


/**
 * CLI usage error
 */
function UsageError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    _TritonBaseVError.call(this, {
        cause: cause,
        message: message,
        code: 'Usage',
        exitStatus: 2
    });
}
util.inherits(UsageError, _TritonBaseVError);


/**
 * An error signing a request.
 */
function SigningError(cause) {
    _TritonBaseVError.call(this, {
        cause: cause,
        message: 'error signing request',
        code: 'Signing',
        exitStatus: 1
    });
}
util.inherits(SigningError, _TritonBaseVError);


/**
 * A 'DEPTH_ZERO_SELF_SIGNED_CERT' An error signing a request.
 */
function SelfSignedCertError(cause, url) {
    var msg = format('could not access CloudAPI %s because it uses a ' +
        'self-signed TLS certificate and your current profile is not ' +
        'configured for insecure access', url);
    _TritonBaseVError.call(this, {
        cause: cause,
        message: msg,
        code: 'SelfSignedCert',
        exitStatus: 1
    });
}
util.inherits(SelfSignedCertError, _TritonBaseVError);


/**
 * A resource (instance, image, ...) was not found.
 */
function ResourceNotFoundError(cause, msg) {
    if (msg === undefined) {
        msg = cause;
        cause = undefined;
    }
    _TritonBaseWError.call(this, {
        cause: cause,
        message: msg,
        code: 'ResourceNotFound',
        exitStatus: 3
    });
}
util.inherits(ResourceNotFoundError, _TritonBaseWError);


/**
 * Multiple errors in a group.
 */
function MultiError(errs) {
    assert.arrayOfObject(errs, 'errs');
    var lines = [format('multiple (%d) errors', errs.length)];
    for (var i = 0; i < errs.length; i++) {
        var err = errs[i];
        lines.push(format('    error (%s): %s', err.code, err.message));
    }
    _TritonBaseVError.call(this, {
        cause: errs[0],
        message: lines.join('\n'),
        code: 'MultiError',
        exitStatus: 1
    });
}
MultiError.description = 'Multiple errors.';
util.inherits(MultiError, _TritonBaseVError);



// ---- exports

module.exports = {
    TritonError: TritonError,
    InternalError: InternalError,
    ConfigError: ConfigError,
    UsageError: UsageError,
    SigningError: SigningError,
    SelfSignedCertError: SelfSignedCertError,
    ResourceNotFoundError: ResourceNotFoundError,
    MultiError: MultiError
};
// vim: set softtabstop=4 shiftwidth=4:
