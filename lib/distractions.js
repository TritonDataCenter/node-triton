/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * A CLI distraction during a long process (e.g. waiting for
 * create).
 *
 * Usage:
 *      var distractions = require('./distractions');
 *      var distraction = distractions.createDistraction([num]);
 *      setTimeout(function () {
 *          distraction.destroy();
 *      }, 5000);
 */

var assert = require('assert-plus');
var bigspinner = require('bigspinner');


function createDistraction(num) {
    assert.optionalNumber(num, 'num');

    var height, width;
    if (num <= 2) {
        height = Math.min(5, process.stdout.rows - 2);
        width = Math.min(5*2, process.stdout.columns - 2);
    } else if (num === 3) {
        height = Math.min(10, process.stdout.rows - 2);
        width = Math.min(10*2, process.stdout.columns - 2);
    } else {
        var BORDER = 10;
        height = Math.max(2, process.stdout.rows - 2 - BORDER);
        width = Math.max(2, process.stdout.columns - 1 - BORDER);
    }
    return bigspinner.createSpinner({
        delay: 50,
        positions: 40,
        stream: process.stderr,
        height: height,
        width: width,
        hideCursor: true,
        //fontChar: '\u2588' // '\x1b[7m \x1b[m'
        fontChar: '#'
    });
}

module.exports = {
    createDistraction: createDistraction
};
