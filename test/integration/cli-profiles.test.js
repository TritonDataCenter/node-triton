/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Test 'profiles' and 'profile'
 */

var fs = require('fs');
var path = require('path');

var h = require('./helpers');
var test = require('tap').test;

var PROFILE_FILE = path.join(__dirname, 'test-profile.json');
var PROFILE_DATA = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

var opts = {
    skip: !h.CONFIG.allowWriteActions
};


// --- Tests

if (opts.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton profiles (read only)', function (suite) {
    suite.test('  triton profile get env', function (t) {
        h.safeTriton(t, {json: true, args: ['profile', 'get', '-j', 'env']},
            function (err, p) {

            t.equal(p.account, h.CONFIG.profile.account,
                'env account correct');
            t.equal(p.keyId, h.CONFIG.profile.keyId,
                'env keyId correct');
            t.equal(p.url, h.CONFIG.profile.url,
                'env url correct');

            t.end();
        });
    });

    suite.end();
});

test('triton profiles (read/write)', opts, function (suite) {
    suite.test('  triton profile create', function (t) {
        /*
         * We need to skip the Docker setup with '--no-docker' because we are
         * using a bogus keyId and CloudAPI url. The Docker setup requires real
         * values because it makes requests to CloudAPI (e.g. ListServices to
         * find the Docker endpoint).
         */
        h.safeTriton(t, ['profile', 'create', '--no-docker',
                '-f', PROFILE_FILE],
            function (err, stdout) {
            t.ok(stdout.match(/^Saved profile/), 'stdout correct');
            t.end();
        });
    });

    suite.test('  triton profile get', function (t) {
        h.safeTriton(t,
            {json: true, args: ['profile', 'get', '-j', PROFILE_DATA.name]},
            function (err, p) {

            t.deepEqual(p, PROFILE_DATA, 'profile matched');
            t.end();
        });
    });

    suite.test('  triton profile delete', function (t) {
        h.safeTriton(t, ['profile', 'delete', '-f', PROFILE_DATA.name],
            function (err, stdout) {

            t.ok(stdout.match(/^Deleted profile/), 'stdout correct');
            t.end();
        });
    });

    suite.end();
});
