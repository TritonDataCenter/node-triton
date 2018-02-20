/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018, Joyent, Inc.
 */

/*
 * Test creating a bhyve VM.
 */

var os = require('os');

var format = require('util').format;
var test = require('tape');

var h = require('./helpers');


// --- globals

var INST_ALIAS = 'nodetritontest-instance-create-bhyve-' +
    os.hostname();

var testOpts = {
    skip: !h.CONFIG.allowWriteActions || h.CONFIG.skipBhyveTests
};


// --- Tests

test('triton image ...', testOpts, function (tt) {
    var imgId;
    var inst;
    var pkgId;

    tt.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        tt.comment(format('- %s: %j', key, value));
    });

    // TODO: `triton rm -f` would be helpful for this
    tt.test('  setup: rm existing inst ' + INST_ALIAS, function (t) {
        h.deleteTestInst(t, INST_ALIAS, function onDel() {
            t.end();
        });
    });

    tt.test('  setup: find image', function (t) {
        h.getTestBhyveImg(t, function (err, _imgId) {
            t.ifError(err, 'getTestImg' + (err ? ': ' + err : ''));
            imgId = _imgId;
            t.end();
        });
    });

    tt.test('  setup: find test package', function (t) {
        h.getTestBhyvePkg(t, function (err, _pkgId) {
            t.ifError(err, 'getTestPkg' + (err ? ': ' + err : ''));
            pkgId = _pkgId;
            t.end();
        });
    });

    tt.test('  setup: triton create ... -n ' + INST_ALIAS, function (t) {
        var argv = ['create', '-wj', '--brand=bhyve', '-n', INST_ALIAS,
            imgId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            inst = lines[1];
            t.ok(inst.id, 'inst.id: ' + inst.id);
            t.equal(lines[1].state, 'running', 'inst is running');
            t.end();
        });
    });

    // TODO: Once have `triton ssh ...` working in test suite without hangs,
    //      then want to check that the created VM works.

    // Remove instance. Add a test timeout, because '-w' on delete doesn't
    // have a way to know if the attempt failed or if it is just taking a
    // really long time.
    tt.test('  cleanup: triton rm', {timeout: 10 * 60 * 1000}, function (t) {
        h.safeTriton(t, ['rm', '-w', inst.id], function () {
            t.end();
        });
    });
});
