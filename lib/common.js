#!/usr/bin/env node
/**
 * Copyright (c) 2014 Joyent Inc. All rights reserved.
 */

var p = console.log;
var assert = require('assert-plus');
var async = require('async');
var backoff = require('backoff');
var fs = require('fs');
var once = require('once');
var sprintf = require('extsprintf').sprintf;
var util = require('util'),
    format = util.format;
var verror = require('verror');

var errors = require('./errors'),
    InternalError = errors.InternalError;


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
 * Print a table of the given items.
 *
 * @params items {Array} of row objects.
 * @params options {Object}
 *      - `columns` {String} of comma-separated field names for columns
 *      - `skipHeader` {Boolean} Default false.
 *      - `sort` {String} of comma-separate fields on which to alphabetically
 *        sort the rows. Optional.
 *      - `validFields` {String} valid fields for `columns` and `sort`
 */
function tabulate(items, options) {
    assert.arrayOfObject(items, 'items');
    assert.object(options, 'options');
    assert.string(options.columns, 'options.columns');
    assert.optionalBool(options.skipHeader, 'options.skipHeader');
    assert.optionalString(options.sort, 'options.sort');
    assert.optionalString(options.validFields, 'options.validFields');

    if (items.length === 0) {
        return;
    }

    // Validate.
    var validFields = options.validFields && options.validFields.split(',');
    var columns = options.columns.split(',');
    var sort = options.sort ? options.sort.split(',') : [];
    if (validFields) {
        columns.forEach(function (c) {
            if (validFields.indexOf(c) === -1) {
                throw new TypeError(sprintf('invalid output field: "%s"', c));
            }
        });
    }
    sort.forEach(function (s) {
        if (s[0] === '-') s = s.slice(1);
        if (validFields && validFields.indexOf(s) === -1) {
            throw new TypeError(sprintf('invalid sort field: "%s"', s));
        }
    });

    // Function to lookup each column field in a row.
    var colFuncs = columns.map(function (lookup) {
        return new Function(
            'try { return (this["' + lookup + '"]); } catch (e) {}');
    });

    // Determine columns and widths.
    var widths = {};
    columns.forEach(function (c) { widths[c] = c.length; });
    items.forEach(function (item) {
        for (var j = 0; j < columns.length; j++) {
            var col = columns[j];
            var cell = colFuncs[j].call(item);
            if (cell === null || cell === undefined) {
                continue;
            }
            widths[col] = Math.max(
                widths[col], (cell ? String(cell).length : 0));
        }
    });

    var template = '';
    for (var i = 0; i < columns.length; i++) {
        if (i === columns.length - 1) {
            // Last column, don't have trailing whitespace.
            template += '%s';
        } else {
            template += '%-' + String(widths[columns[i]]) + 's  ';
        }
    }

    function cmp(a, b) {
        for (var j = 0; j < sort.length; j++) {
            var field = sort[j];
            var invert = false;
            if (field[0] === '-') {
                invert = true;
                field = field.slice(1);
            }
            assert.ok(field.length, 'zero-length sort field: ' + options.sort);
            var a_cmp = Number(a[field]);
            var b_cmp = Number(b[field]);
            if (isNaN(a_cmp) || isNaN(b_cmp)) {
                a_cmp = a[field] || '';
                b_cmp = b[field] || '';
            }
            if (a_cmp < b_cmp) {
                return (invert ? 1 : -1);
            } else if (a_cmp > b_cmp) {
                return (invert ? -1 : 1);
            }
        }
        return 0;
    }
    if (sort.length) {
        items.sort(cmp);
    }

    if (!options.skipHeader) {
        var header = columns.map(function (c) { return c.toUpperCase(); });
        header.unshift(template);
        console.log(sprintf.apply(null, header));
    }
    items.forEach(function (item) {
        var row = [];
        for (var j = 0; j < colFuncs.length; j++) {
            var cell = colFuncs[j].call(item);
            if (cell === null || cell === undefined) {
                row.push('-');
            } else {
                row.push(String(cell));
            }
        }
        row.unshift(template);
        console.log(sprintf.apply(null, row));
    });
}


//---- exports

module.exports = {
    objCopy: objCopy,
    deepObjCopy: deepObjCopy,
    zeroPad: zeroPad,
    boolFromString: boolFromString,
    tabulate: tabulate
};
// vim: set softtabstop=4 shiftwidth=4:
