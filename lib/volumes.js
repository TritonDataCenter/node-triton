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
 * Unit format suffix can only be 'G' for gibibytes.
 *
 * Example: the strings '100G' represents 100 gibibytes
 *
 * If "size" is not a valid size string, an error is thrown.
 */
function parseVolumeSize(size) {
    assert.string(size, 'size');

    var baseValue;
    var MIBS_IN_GB = 1024;

    var matches = size.match(/^([1-9]\d*)G$/);
    if (!matches) {
        throwInvalidSize(size);
    }

    baseValue = Number(matches[1]);

    if (isNaN(baseValue)) {
        throwInvalidSize(size);
    }

    return baseValue * MIBS_IN_GB;
}

module.exports = {
    parseVolumeSize: parseVolumeSize
};