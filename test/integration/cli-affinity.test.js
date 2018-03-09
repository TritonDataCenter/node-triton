/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Test affinity/locality hints with `triton create -a RULE ...`.
 *
 * This is really only testable against a DC with multiple target CNs (i.e.
 * COAL is out), and even then it is hard to test more than just basic cases
 * without knowing some details about the CN provisioning pool.
 */

var format = require('util').format;
var os = require('os');
var test = require('tape');
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');


// --- globals

var ALIAS_PREFIX = format('nodetritontest-affinity-%s', os.hostname());

var testOpts = {
    skip: !h.CONFIG.allowWriteActions || h.CONFIG.skipAffinityTests
};


// --- Tests

test('affinity (triton create -a RULE ...)', testOpts, function (tt) {
    tt.comment('Add \'"skipAffinityTests":true\' to test/config.json if ' +
        'this target DC does not have multiple provisionable CNs (e.g. COAL).');

    // TODO: `triton rm -f` would be helpful for this
    tt.test('  setup: rm existing insts ' + ALIAS_PREFIX + '*', function (t) {
        // Cheat and use the current SNAFU behaviour that 'name=foo' matches
        // all VMs *prefixed* with "foo".
        h.safeTriton(t, ['inst', 'list', '-j', 'name='+ALIAS_PREFIX],
                function (err, stdout) {
            var instsToRm = h.jsonStreamParse(stdout);
            if (instsToRm.length === 0) {
                t.end();
                return;
            }
            var rmCmd = ['inst', 'rm', '-w'].concat(
                instsToRm.map(function (i) { return i.id; }));
            h.safeTriton(t, rmCmd, function () {
                t.ok(true, rmCmd.join(' '));
                t.end();
            });
        });
    });

    var imgId;
    tt.test('  setup: find test image', function (t) {
        h.getTestImg(t, function (err, imgId_) {
            t.ifError(err, 'getTestImg' + (err ? ': ' + err : ''));
            imgId = imgId_;
            t.end();
        });
    });

    var pkgId;
    tt.test('  setup: find test package', function (t) {
        h.getTestPkg(t, function (err, pkgId_) {
            t.ifError(err, 'getTestPkg' + (err ? ': ' + err : ''));
            pkgId = pkgId_;
            t.end();
        });
    });

    var db0Alias = ALIAS_PREFIX + '-db0';
    var db0;
    tt.test('  setup: triton create -n db0', function (t) {
        var argv = ['create', '-wj', '-n', db0Alias, '-t', 'role=database',
            imgId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            db0 = lines[1];
            t.end();
        });
    });

    // Test db1 being put on same server as db0.
    var db1Alias = ALIAS_PREFIX + '-db1';
    var db1;
    tt.test('  triton create -n db1 -a instance==db0', function (t) {
        var argv = ['create', '-wj', '-n', db1Alias, '-a',
            'instance==' + db0Alias, imgId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            db1 = lines[1];
            t.equal(db0.compute_node, db1.compute_node,
                format('inst %s landed on same CN as inst %s: %s',
                    db1Alias, db0Alias, db1.compute_node));
            t.end();
        });
    });

    // Test db2 being put on a server without a db.
    var db2Alias = ALIAS_PREFIX + '-db2';
    var db2;
    tt.test('  triton create -n db2 -a \'instance!=db*\'', function (t) {
        var argv = ['create', '-wj', '-n', db2Alias, '-a', 'instance!=db*',
            imgId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            db2 = lines[1];
            t.notEqual(db0.compute_node, db2.compute_node,
                format('inst %s landed on different CN (%s) as inst %s (%s)',
                    db2Alias, db2.compute_node, db0Alias, db0.compute_node));
            t.end();
        });
    });


    // Test db3 being put on server *other* than db0.
    var db3Alias = ALIAS_PREFIX + '-db3';
    var db3;
    tt.test('  triton create -n db3 -a \'instance!=db0\'', function (t) {
        var argv = ['create', '-wj', '-n', db3Alias, '-a',
            'instance!='+db0Alias, imgId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            db3 = lines[1];
            t.notEqual(db0.compute_node, db3.compute_node,
                format('inst %s landed on different CN (%s) as inst %s (%s)',
                    db3Alias, db3.compute_node, db0Alias, db0.compute_node));
            t.end();
        });
    });

    // Test db4 being put on server *other* than db0 (due ot db0's tag).
    var db4Alias = ALIAS_PREFIX + '-db4';
    var db4;
    tt.test('  triton create -n db4 -a \'role!=database\'', function (t) {
        var argv = ['create', '-wj', '-n', db4Alias, '-a', 'role!=database',
            imgId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            db4 = lines[1];
            t.notEqual(db0.compute_node, db4.compute_node,
                format('inst %s landed on different CN (%s) as inst %s (%s)',
                    db4Alias, db4.compute_node, db0Alias, db0.compute_node));
            t.end();
        });
    });

    // Remove instances. Add a test timeout, because '-w' on delete doesn't
    // have a way to know if the attempt failed or if it is just taking a
    // really long time.
    tt.test('  cleanup: triton rm', {timeout: 10 * 60 * 1000}, function (t) {
        h.safeTriton(t, ['rm', '-w', db0.id, db1.id, db2.id, db3.id, db4.id],
        function () {
            t.end();
        });
    });
});
