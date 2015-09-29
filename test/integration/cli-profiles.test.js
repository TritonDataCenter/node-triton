/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test 'profiles' and 'profile'
 */

var fs = require('fs');
var path = require('path');

var h = require('./helpers');
var test = require('tape');

var PROFILE_FILE = path.join(__dirname, 'test-profile.json');
var PROFILE_DATA = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

var opts = {
    skip: !h.CONFIG.destructiveAllowed
};

// --- Tests

if (opts.skip) {
    console.error('** skipping triton profile creation tests');
    console.error('** set "destructiveAllowed" to enable');
}

test('triton profiles (read only)', function (tt) {
    tt.test('triton profile env', function (t) {
        h.safeTriton(t, {json: true, args: ['profile', '-j', 'env']},
            function (p) {

            t.equal(p.account,
                process.env.TRITON_ACCOUNT || process.env.SDC_ACCOUNT,
                'env account correct');
            t.equal(p.keyId,
                process.env.TRITON_KEY_ID || process.env.SDC_KEY_ID,
                'env keyId correct');
            t.equal(p.url,
                process.env.TRITON_URL || process.env.SDC_URL,
                'env url correct');

            t.end();
        });
    });

    tt.end();
});

test('triton profiles (read/write)', opts, function (tt) {
    tt.test('triton profile create', function (t) {
        h.safeTriton(t, ['profile', '-a', PROFILE_FILE],
            function (stdout) {

            t.ok(stdout.match(/^Saved profile/), 'stdout correct');
            t.end();
        });
    });

    tt.test('triton profile get', function (t) {
        h.safeTriton(t,
            {json: true, args: ['profile', '-j', PROFILE_DATA.name]},
            function (p) {

            t.deepEqual(p, PROFILE_DATA, 'profile matched');

            t.end();
        });
    });

    tt.test('triton profile delete', function (t) {
        h.safeTriton(t, ['profile', '-df', PROFILE_DATA.name],
            function (stdout) {

            t.ok(stdout.match(/^Deleted profile/), 'stdout correct');
            t.end();
        });
    });

    tt.end();
});
