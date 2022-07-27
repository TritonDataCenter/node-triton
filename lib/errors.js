/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 *
 * Error classes that the triton CLI may produce.
 */

var cmdln = require('cmdln');
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
function _TritonBaseVError(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.message, 'opts.message');
    assert.optionalString(opts.code, 'opts.code');
    assert.optionalObject(opts.cause, 'opts.cause');
    assert.optionalNumber(opts.statusCode, 'opts.statusCode');
    var self = this;

    /*
     * If the given cause has `body.errors` a la
     * // JSSTYLED
     * https://github.com/TritonDataCenter/eng/blob/master/docs/index.md#error-handling
     * then lets add text about those specifics to the error message.
     */
    var message = opts.message;
    if (opts.cause && opts.cause.body && opts.cause.body.errors) {
        opts.cause.body.errors.forEach(function (e) {
            message += format('\n    %s: %s', e.field, e.code);
            if (e.message) {
                message += ': ' + e.message;
            }
        });
    }

    var veArgs = [];
    if (opts.cause) veArgs.push(opts.cause);
    veArgs.push(message);
    VError.apply(this, veArgs);

    var extra = Object.keys(opts).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = opts[k];
    });
}
util.inherits(_TritonBaseVError, VError);

/*
 * Base error class that doesn't include a 'cause' message in its message.
 * This is useful in cases where we are wrapping CloudAPI errors with
 * onces that should *replace* the CloudAPI error message.
 */
function _TritonBaseWError(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.message, 'opts.message');
    assert.optionalString(opts.code, 'opts.code');
    assert.optionalObject(opts.cause, 'opts.cause');
    assert.optionalNumber(opts.statusCode, 'opts.statusCode');
    var self = this;

    var weArgs = [];
    if (opts.cause) weArgs.push(opts.cause);
    weArgs.push(opts.message);
    WError.apply(this, weArgs);

    var extra = Object.keys(opts).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = opts[k];
    });
}
util.inherits(_TritonBaseWError, WError);


/*
 * A generic (i.e. a cop out) code-less error.
 *
 * Usage:
 *      new TritonError(<message>)
 *      new TritonError(<cause>, <message>)
 */
function TritonError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message, 'message');
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
 * Error in config or profile data.
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
 * Error in setting up (typically in profile update/creation).
 */
function SetupError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    _TritonBaseVError.call(this, {
        cause: cause,
        message: message,
        code: 'Setup',
        exitStatus: 1
    });
}
util.inherits(SetupError, _TritonBaseVError);



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
    assert.string(url, 'url');
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
 * A timeout was reached waiting/polling for something.
 */
function TimeoutError(cause, msg) {
    if (msg === undefined) {
        msg = cause;
        cause = undefined;
    }
    assert.string(msg, 'msg');
    _TritonBaseVError.call(this, {
        cause: cause,
        message: msg,
        code: 'Timeout',
        exitStatus: 1
    });
}
util.inherits(TimeoutError, _TritonBaseVError);


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
 * An instance was deleted.
 */
function InstanceDeletedError(cause, msg) {
    if (msg === undefined) {
        msg = cause;
        cause = undefined;
    }
    _TritonBaseWError.call(this, {
        cause: cause,
        message: msg,
        code: 'InstanceDeleted',
        exitStatus: 3
    });
}
util.inherits(InstanceDeletedError, _TritonBaseWError);


/**
 * Multiple errors in a group.
 */
function MultiError(errs) {
    assert.arrayOfObject(errs, 'errs');
    var lines = [format('multiple (%d) errors', errs.length)];
    for (var i = 0; i < errs.length; i++) {
        var err = errs[i];
        if (err.code) {
            lines.push(format('    error (%s): %s', err.code, err.message));
        } else {
            lines.push(format('    error: %s', err.message));
        }
    }
    _TritonBaseWError.call(this, {
        cause: errs[0],
        message: lines.join('\n'),
        code: 'MultiError',
        exitStatus: 1
    });
}
MultiError.description = 'Multiple errors.';
util.inherits(MultiError, _TritonBaseWError);



// ---- exports

module.exports = {
    TritonError: TritonError,
    InternalError: InternalError,
    ConfigError: ConfigError,
    UsageError: cmdln.UsageError,
    SetupError: SetupError,
    SigningError: SigningError,
    SelfSignedCertError: SelfSignedCertError,
    TimeoutError: TimeoutError,
    ResourceNotFoundError: ResourceNotFoundError,
    InstanceDeletedError: InstanceDeletedError,
    MultiError: MultiError
};
// vim: set softtabstop=4 shiftwidth=4:
