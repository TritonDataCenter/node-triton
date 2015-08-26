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
 * @param errName {String} The variable name to quote in the possibly
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
        throw new TypeError(
            format('invalid value for "%s": %j', errName, value));
    }
}

/**
 * given an array return a string with each element
 * JSON-stringifed separated by newlines
 */
function jsonStream(arr) {
    return arr.map(function (elem) {
        return JSON.stringify(elem);
    }).join('\n');
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
        ['h', 24, 'd']
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
        } else if (size[2] === 'd') {
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
 */
function humanSizeFromBytes(bytes) {
    assert.number(bytes, 'bytes');
    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    if (bytes === 0) {
        return '0 B';
    }
    var i = Number(Math.floor(Math.log(bytes) / Math.log(1024)));
    var s = String(bytes / Math.pow(1024, i));
    var precision1 = (s.indexOf('.') === -1
        ? s + '.0' : s.slice(0, s.indexOf('.') + 2));
    return format('%s %s', precision1, sizes[i]);
}

function capitalize(s) {
    return s[0].toUpperCase() + s.substr(1);
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
    capitalize: capitalize
};
// vim: set softtabstop=4 shiftwidth=4:
