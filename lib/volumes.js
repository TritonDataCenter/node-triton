/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');

function throwInvalidSize(size) {
    assert.string(size, 'size');

    throw new Error('size "' + size + '" is not a valid volume size');
}

/*
 * Returns the number of MiBs (Mebibytes) represented by the string "size". That
 * string has the following format: <integer><unit>. The integer must be > 0.
 * Unit format suffixes are 'G' or 'g' for gibibytes and 'M' or 'm' for
 * mebibytes. If no unit suffix is provided, the unit is considered to be
 * mebibytes.
 *
 * Examples:
 *    - the string '100' represents 100 mebibytes
 *    - the strings '100m' and '100M' represent 100 mebibytes
 *    - the strings '100g' and '100G' represent 100 gibibytes
 *
 * If "size" is not a valid size string, an error is thrown.
 */
function parseVolumeSize(size) {
    assert.string(size, 'size');

    var MIBS_IN_GB = 1024;

    var MULTIPLIERS_TABLE = {
        g: MIBS_IN_GB,
        G: MIBS_IN_GB,
        m: 1,
        M: 1
    };

    var multiplier = 1; /* default unit is mebibytes */
    var multiplierSymbol;
    var baseValue;

    var matches = size.match(/^([1-9]\d*)(g|m|G|M)?$/);
    if (!matches) {
        throwInvalidSize(size);
    }

    multiplierSymbol = matches[2];
    if (multiplierSymbol) {
        multiplier = MULTIPLIERS_TABLE[multiplierSymbol];
    }

    baseValue = Number(matches[1]);
    if (isNaN(baseValue)) {
        throwInvalidSize(size);
    }

    return baseValue * multiplier;
}

module.exports = {
    parseVolumeSize: parseVolumeSize
};