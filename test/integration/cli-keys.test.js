/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for `triton key ...`
 */

var h = require('./helpers');
var test = require('tape');
var backoff = require('backoff');



// --- Globals

var KEY_PATH = __dirname + '/data/id_rsa.pub';
var KEY_SIG  = '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0';
var KEY_EMAIL = 'test@localhost.local';
var KEY_NAME = 'nodetritontest-key1';
var MAX_CHECK_KEY_TRIES = 10;

// --- Tests

test('triton key', function (tt) {
    tt.test(' triton key add', function (t) {
        var cmd = 'key add -n ' + KEY_NAME + ' ' + KEY_PATH;
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton key add'))
                return t.end();

            t.equal(stdout, 'Added key "' + KEY_NAME + '" (' + KEY_SIG + ')\n');
            t.end();
        });
    });

    tt.test(' triton key get', function (t) {
        h.triton('key get ' + KEY_SIG, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton key get'))
                return t.end();

            t.ok(stdout.match(KEY_EMAIL), 'test key email present');
            t.end();
        });
    });

    tt.test(' triton key list', function (t) {
        h.triton('key list', function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton key list'))
                return t.end();

            var keys = stdout.split('\n');
            t.ok(keys[0].match('FINGERPRINT'));
            keys.shift();

            // there should always be at least two keys -- the original
            // account's key, and the test key these tests added
            t.ok(keys.length > 2, 'triton key list expected key num');

            var testKeys = keys.filter(function (key) {
                return key.match(KEY_NAME);
            });

            // this test is a tad dodgy, since it's plausible that there might
            // be other test keys with different signatures lying around
            t.equal(testKeys.length, 1, 'triton key list test key found');

            t.end();
        });
    });

    tt.test(' triton key delete', function (t) {
        var cmd = 'key delete ' + KEY_SIG + ' --yes';
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton key delete'))
                return t.end();

            t.ok(stdout.match('Deleted key "' + KEY_SIG + '"'), 'key deleted');

            // verify key is gone, which sometimes takes a while
            var call = backoff.call(function checkKey(next) {
                h.triton('key get ' + KEY_SIG, function (err2) {
                    next(!err2);
                });
            }, function (err3) {
                h.ifErr(t, err3, 'triton key delete did not remove key');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });
});
