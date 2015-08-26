#!/usr/bin/env node
/**
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 */


var assert = require('assert-plus');
var sprintf = require('extsprintf').sprintf;
var util = require('util'),
    format = util.format;

var errors = require('./errors'),
    InternalError = errors.InternalError;


// ---- globals

var p = console.log;



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
        seconds / 60 / 60 / 24 / 30,  // months
        seconds / 60 / 60 / 24,       // days
        seconds / 60 / 60,            // hours
        seconds / 60,                 // minutes
        seconds                       // seconds
    ];
    var names = ['y', 'mon', 'd', 'h', 'min', 's'];

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

//---- exports

module.exports = {
    objCopy: objCopy,
    deepObjCopy: deepObjCopy,
    zeroPad: zeroPad,
    boolFromString: boolFromString,
    jsonStream: jsonStream,
    kvToObj: kvToObj,
    longAgo: longAgo,
    isUUID: isUUID,
};
// vim: set softtabstop=4 shiftwidth=4:
