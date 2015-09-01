/**
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 */

var assert = require('assert-plus');
var util = require('util'),
    format = util.format;

var errors = require('./errors'),
    InternalError = errors.InternalError;


// ---- globals

var p = console.log;

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;


// ---- support stuff

function objCopy(obj, target) {
    if (target === undefined) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}


function deepObjCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}


function zeroPad(n, width) {
    var s = String(n);
    while (s.length < width) {
        s = '0' + s;
    }
    return s;
}


/**
 * Convert a boolean or string representation into a boolean, or
 * raise TypeError trying.
 *
 * @param value {Boolean|String} The input value to convert.
 * @param default_ {Boolean} The default value is `value` is undefined.
 * @param errName {String} The context to quote in the possibly
 *      raised TypeError.
 */
function boolFromString(value, default_, errName) {
    if (value === undefined) {
        return default_;
    } else if (value === 'false' || value === '0') {
        return false;
    } else if (value === 'true' || value === '1') {
        return true;
    } else if (typeof (value) === 'boolean') {
        return value;
    } else {
        var errmsg = format('invalid boolean value: %j', value);
        if (errName) {
            errmsg = format('invalid boolean value for %s: %j', errName, value);
        }
        throw new TypeError(errmsg);
    }
}

/**
 * given an array return a string with each element
 * JSON-stringifed separated by newlines
 */
function jsonStream(arr, stream) {
    stream = stream || process.stdout;
    arr.forEach(function (elem) {
        stream.write(JSON.stringify(elem) + '\n');
    });
}

/**
 * given an array of key=value pairs, break them into an object
 *
 * @param {Array} kvs - an array of key=value pairs
 * @param {Array} valid (optional) - an array to validate pairs
 */
function kvToObj(kvs, valid) {
    var o = {};
    for (var i = 0; i < kvs.length; i++) {
        var kv = kvs[i];
        var idx = kv.indexOf('=');
        if (idx === -1)
             throw new errors.UsageError(format(
                            'invalid filter: "%s" (must be of the form "field=value")',
                            kv));
        var k = kv.slice(0, idx);
        var v = kv.slice(idx + 1);
        if (valid.indexOf(k) === -1)
             throw new errors.UsageError(format(
                            'invalid filter name: "%s" (must be one of "%s")',
                            k, valid.join('", "')));
        o[k] = v;
    }
    return o;
}

/**
 * return how long ago something happened
 *
 * @param {Date} when - a date object in the past
 * @param {Date} now (optional) - a date object to compare to
 * @return {String} - printable string
 */
function longAgo(when, now) {
    now = now || new Date();
    var seconds = Math.round((now - when) / 1000);
    var times = [
        seconds / 60 / 60 / 24 / 365, // years
        seconds / 60 / 60 / 24 / 7,   // weeks
        seconds / 60 / 60 / 24,       // days
        seconds / 60 / 60,            // hours
        seconds / 60,                 // minutes
        seconds                       // seconds
    ];
    var names = ['y', 'w', 'd', 'h', 'm', 's'];

    for (var i = 0; i < names.length; i++) {
        var time = Math.floor(times[i]);
        if (time > 0)
            return util.format('%d%s', time, names[i]);
    }
    return '0s';
}

/**
 * checks a string and returns a boolean based on if it
 * is a UUID or not
 */
function isUUID(s) {
    return /^([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)$/i.test(s);
}


function humanDurationFromMs(ms) {
    assert.number(ms, 'ms');
    var sizes = [
        ['ms', 1000, 's'],
        ['s', 60, 'm'],
        ['m', 60, 'h'],
        ['h', 24, 'd'],
        ['d', 7, 'w']
    ];
    if (ms === 0) {
        return '0ms';
    }
    var bits = [];
    var n = ms;
    for (var i = 0; i < sizes.length; i++) {
        var size = sizes[i];
        var remainder = n % size[1];
        if (remainder === 0) {
            bits.unshift('');
        } else {
            bits.unshift(format('%d%s', remainder, size[0]));
        }
        n = Math.floor(n / size[1]);
        if (n === 0) {
            break;
        } else if (i === sizes.length - 1) {
            bits.unshift(format('%d%s', n, size[2]));
            break;
        }
    }
    if (bits.length > 1 && bits[bits.length - 1].slice(-2) === 'ms') {
        bits.pop();
    }
    return bits.slice(0, 2).join('');
}

/**
 * Adapted from <http://stackoverflow.com/a/18650828>
 *
 * @param {Number} opts.precision The number of decimal places of precision to
 *      include. Note: This is just clipping (i.e. floor) instead of rounding.
 *      TODO: round
 * @param {Boolean} opts.narrow Make it as narrow as possible: short units,
 *      no space between value and unit, drop precision if it is all zeros.
 */
function humanSizeFromBytes(opts, bytes) {
    if (bytes === undefined) {
        bytes = opts;
        opts = {};
    }
    assert.number(bytes, 'bytes');
    // The number of decimal places, default 1.
    assert.optionalNumber(opts.precision, 'opts.precision');
    var precision = opts.precision === undefined ? 1 : opts.precision;
    assert.ok(precision >= 0);
    assert.optionalBool(opts.narrow, 'opts.narrow');

    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    if (opts.narrow) {
        sizes = ['B', 'K', 'M', 'G', 'T', 'P'];
    }
    var template = opts.narrow ? '%s%s%s' : '%s%s %s';

    if (bytes === 0) {
        return '0 B';
    }

    var sign = bytes < 0 ? '-' : '';
    bytes = Math.abs(bytes);

    var i = Number(Math.floor(Math.log(bytes) / Math.log(1024)));
    var s = String(bytes / Math.pow(1024, i));
    var hasDecimal = s.indexOf('.') !== -1;
    if (precision === 0) {
        if (hasDecimal) {
            s = s.slice(0, s.indexOf('.'));
        }
    } else if (opts.narrow && !hasDecimal) {
        /* skip all-zero precision */
        /* jsl:pass */
    } else {
        if (!hasDecimal) {
            s += '.';
        }
        var places = s.length - s.indexOf('.') - 1;
        while (places < precision) {
            s += '0';
            places++;
        }
        if (places > precision) {
            s = s.slice(0, s.length - places + precision);
        }
    }
    //var precision1 = (s.indexOf('.') === -1
    //    ? s + '.0' : s.slice(0, s.indexOf('.') + 2));

    return format(template, sign, s, sizes[i]);
}

function capitalize(s) {
    return s[0].toUpperCase() + s.substr(1);
}

/*
 * Normalize a short ID. Returns undefined if the given string isn't a valid
 * short id.
 *
 * Short IDs:
 * - UUID prefix
 * - allow '-' to be elided (to support using containers IDs from
 *   docker)
 * - support docker ID *longer* than a UUID? The curr implementation does.
 */
function normShortId(s) {
    var shortIdCharsRe = /^[a-f0-9]+$/;
    var shortId;
    if (s.indexOf('-') === -1) {
        if (!shortIdCharsRe.test(s)) {
            return;
        }
        shortId = s.substr(0, 8) + '-'
            + s.substr(8, 4) + '-'
            + s.substr(12, 4) + '-'
            + s.substr(16, 4) + '-'
            + s.substr(20, 12);
        shortId = shortId.replace(/-+$/, '');
    } else {
        // UUID prefix.
        shortId = '';
        var remaining = s;
        var spans = [8, 4, 4, 4, 12];
        for (var i = 0; i < spans.length; i++) {
            var span = spans[i];
            var head = remaining.slice(0, span);
            remaining = remaining.slice(span + 1);
            if (!shortIdCharsRe.test(head)) {
                return;
            }
            shortId += head;
            if (remaining) {
                shortId += '-';
            } else {
                break;
            }
        }
    }
    return shortId;
}



//---- exports

module.exports = {
    UUID_RE: UUID_RE,
    objCopy: objCopy,
    deepObjCopy: deepObjCopy,
    zeroPad: zeroPad,
    boolFromString: boolFromString,
    jsonStream: jsonStream,
    kvToObj: kvToObj,
    longAgo: longAgo,
    isUUID: isUUID,
    humanDurationFromMs: humanDurationFromMs,
    humanSizeFromBytes: humanSizeFromBytes,
    capitalize: capitalize,
    normShortId: normShortId
};
// vim: set softtabstop=4 shiftwidth=4:
