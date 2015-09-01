/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * A CLI distraction during a long process (e.g. waiting for
 * create).
 *
 * Usage:
 *      var distractions = require('./distractions');
 *      var distraction = distractions.createDistraction();
 *      setTimeout(function () {
 *          distraction.destroy();
 *      }, 5000);
 */

var bigspinner = require('bigspinner');


function createDistraction() {
    var BORDER = 10;
    return bigspinner.createSpinner({
        delay: 50,
        positions: 40,
        stream: process.stderr,
        height: Math.max(2, process.stdout.rows - 2 - BORDER),
        width: Math.max(2, process.stdout.columns - 1 - BORDER),
        hideCursor: true,
        fontChar: '\u2588' // '\x1b[7m \x1b[m'
    });
}

module.exports = {
    createDistraction: createDistraction
}
