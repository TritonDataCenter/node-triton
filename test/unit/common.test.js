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

test('objCopy+deepObjCopy', function (t) {
    var o1 = {foo: 'bar'};
    var o2 = {arr: [1, 2, 3]};

    // shallow copy
    var c1 = common.objCopy(o1);
    var c2 = common.objCopy(o2);

    t.notEqual(c1, o1);
    t.deepEqual(c1, o1);

    t.notEqual(c2, o2);
    t.deepEqual(c2, o2);

    t.equal(c2.arr, o2.arr);

    var foo = {};
    common.objCopy(o1, foo);
    t.notEqual(foo, o1);
    t.deepEqual(foo, o1);

    // deep copy
    var d1 = common.deepObjCopy(o1);
    var d2 = common.deepObjCopy(o2);

    t.notEqual(d1, o1);
    t.deepEqual(d1, o1);

    t.notEqual(d2, o2);
    t.deepEqual(d2, o2);

    t.notEqual(d2.arr, o2.arr);
    t.deepEqual(d2.arr, o2.arr);

    t.end();
});

test('zeroPad', function (t) {
    var zp = common.zeroPad;

    t.equal(zp(5, 3), '005');
    t.equal(zp(50, 3), '050');
    t.equal(zp(500, 3), '500');

    t.equal(zp('5', 3), '005');
    t.equal(zp('50', 3), '050');
    t.equal(zp('500', 3), '500');

    t.end();
});

test('boolFromString', function (t) {
    var bfs = common.boolFromString;

    t.equal(bfs(true), true);
    t.equal(bfs('true'), true);
    t.equal(bfs('1'), true);

    t.equal(bfs(false), false);
    t.equal(bfs('false'), false);
    t.equal(bfs('0'), false);

    t.equal(bfs(undefined, false), false);
    t.equal(bfs(undefined, true), true);
    t.equal(bfs(undefined, 'foo'), 'foo');

    t.throws(bfs.bind(null, '2'));
    t.throws(bfs.bind(null, 500));
    t.throws(bfs.bind(null, Infinity));
    t.throws(bfs.bind(null, NaN));

    t.end();
});

test('jsonStream', function (t) {
    // TODO this is a lame excuse for a stream
    var s = '';
    var stream = {
        write: function (o) { s += o; }
    };

    var obj = [
        'foo',
        'bar',
        'baz'
    ];

    common.jsonStream(obj, stream);
    t.equal(s, '"foo"\n"bar"\n"baz"\n');

    t.end();
});

test('objFromKeyValueArgs', function (t) {
    var arr = ['foo=1', 'bar=2', 'baz=3'];
    var o = {
        foo: '1',
        bar: '2',
        baz: '3'
    };
    var kv;

    // no valid parameter
    kv = common.objFromKeyValueArgs(arr, {
        disableDotted: true,
        disableTypeConversions: true
    });

    t.deepEqual(kv, o);

    // valid parameters
    kv = common.objFromKeyValueArgs(arr, {
        validKeys: ['foo', 'bar', 'baz'],
        disableDotted: true,
        disableTypeConversions: true
    });

    t.deepEqual(kv, o);

    // invalid parameters
    t.throws(function () {
        common.objFromKeyValueArgs(arr, {
            validKeys: ['uh-oh'],
            disableDotted: true,
            disableTypeConversions: true
        });
    });

    t.end();
});

test('objFromKeyValueArgs failOnEmptyValue', function (t) {
    var arr = ['foo='];
    var err;

    try {
        common.objFromKeyValueArgs(arr, {
            failOnEmptyValue: true
        });
    } catch (e) {
        err = e;
    }

    t.ok(err);

    /*
     * By default, failOnEmptyValue is not set, so the following should not
     * throw an error.
     */
    err = null;
    try {
        common.objFromKeyValueArgs(arr);
    } catch (e) {
        err = e;
    }
    t.equal(err, null);

    /*
     * Explicitly setting failOnEmptyValue to false should not throw an error
     * when passing a key/value with an empty value.
     */
    err = null;
    try {
        common.objFromKeyValueArgs(arr, {
            failOnEmptyValue: false
        });
    } catch (e) {
        err = e;
    }
    t.equal(err, null);

    t.end();
});

test('longAgo', function (t) {
    var la = common.longAgo;
    var now = new Date();
    var then;

    t.equal(la(now, now), '0s');

    then = now - 1000;
    t.equal(la(then, now), '1s');

    then = now - 60 * 1000;
    t.equal(la(then, now), '1m');

    then = now - 60 * 60 * 1000;
    t.equal(la(then, now), '1h');

    then = now - 24 * 60 * 60 * 1000;
    t.equal(la(then, now), '1d');

    then = now - 7 * 24 * 60 * 60 * 1000;
    t.equal(la(then, now), '1w');

    then = now - 365 * 24 * 60 * 60 * 1000;
    t.equal(la(then, now), '1y');

    t.end();
});

test('humanDurationFromMs', function (t) {
    var humanDurationFromMs = common.humanDurationFromMs;
    var ms = 1000;
    var second = 1 * ms;
    var minute = 60 * second;
    var hour = minute * 60;
    var day = hour * 24;
    var week = day * 7;

    t.equal(humanDurationFromMs(47*second), '47s');
    t.equal(humanDurationFromMs(1*week), '1w');
    t.equal(humanDurationFromMs(0), '0ms');

    t.end();
});

test('humanSizeFromBytes', function (t) {
    var humanSizeFromBytes = common.humanSizeFromBytes;

    t.equal(humanSizeFromBytes(-1), '-1.0 B');
    t.equal(humanSizeFromBytes(0), '0 B');
    t.equal(humanSizeFromBytes(1), '1.0 B');

    t.equal(humanSizeFromBytes({}, 0), '0 B');
    t.equal(humanSizeFromBytes({}, 1024), '1.0 KiB');
    t.equal(humanSizeFromBytes({narrow: true}, 1024), '1K');
    t.equal(humanSizeFromBytes({precision: 2}, 1024), '1.00 KiB');

    t.end();
});
