/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Unit tests for "lib/common.js".
 */

var common = require('../../lib/common');
var test = require('tape');


// ---- globals

var log = require('../lib/log');


// ---- tests

test('humanDurationFromMs', function (t) {
    var humanDurationFromMs = common.humanDurationFromMs;
    var ms = 1000;
    var second = 1 * ms;
    var minute = 60 * second;
    var hour = minute * 60;
    var day = hour * 24;
    var week = day * 7;
    var year = day * 365;

    t.equal(humanDurationFromMs(47*second), '47s');
    t.equal(humanDurationFromMs(1*week), '1w');

    t.end();
});
