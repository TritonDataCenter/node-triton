/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Integration tests for `triton instance snapshot ...`
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tape');

// --- Globals

var SNAP_NAME = 'test-snapshot';
var INST_ALIAS = f('nodetritontest-snapshots-%s', os.hostname());
var INST;
var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};

// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton instance snapshot', OPTS, function (tt) {
    h.printConfig(tt);

    tt.test('  cleanup existing inst with alias ' + INST_ALIAS, function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    tt.test('  setup: triton instance create', function (t) {
        h.createTestInst(t, INST_ALIAS, function onInst(err2, instId) {
            if (h.ifErr(t, err2, 'triton instance create'))
                return t.end();

            INST = instId.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    tt.test('  triton instance snapshot create', function (t) {
        var cmd = 'instance snapshot create -w -n ' + SNAP_NAME + ' ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot create'))
                return t.end();

            t.ok(stdout.match('Created snapshot "' + SNAP_NAME + '" in \\d+'),
                 'snapshot made');

            t.end();
        });
    });

    tt.test('  triton instance snapshot get', function (t) {
        var cmd = 'instance snapshot get ' + INST + ' ' + SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot get'))
                return t.end();

            var obj = JSON.parse(stdout);
            t.equal(obj.name, SNAP_NAME, 'snapshot name is correct');
            t.equal(obj.state, 'created', 'snapshot was properly created');

            t.end();
        });
    });

    tt.test('  triton instance snapshot list', function (t) {
        var cmd = 'instance snapshot list ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot list'))
                return t.end();

            var snaps = stdout.split('\n');
            t.ok(snaps[0].match(/NAME\s+STATE\s+CREATED/));
            snaps.shift();

            t.ok(snaps.length >= 1, 'triton snap list expected snap num');

            var testSnaps = snaps.filter(function (snap) {
                return snap.match(SNAP_NAME);
            });

            t.equal(testSnaps.length, 1, 'triton snap list test snap found');

            t.end();
        });
    });

    tt.test('  triton instance start --snapshot', function (t) {
        var cmd = 'instance start ' + INST + ' -w --snapshot=' + SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance start --snapshot'))
                return t.end();

            t.ok(stdout.match('Start instance ' + INST));

            t.end();
        });
    });

    tt.test('  triton instance snapshot delete', function (t) {
        var cmd = 'instance snapshot delete  -w --force ' + INST + ' ' +
                  SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot delete'))
                return t.end();

            t.ok(stdout.match('Deleting snapshot "' + SNAP_NAME + '"',
                 'deleting snapshot'));
            t.ok(stdout.match('Deleted snapshot "' + SNAP_NAME + '" in \\d+s',
                 'deleted snapshot'));

            t.end();
        });
    });

    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    tt.test('  cleanup: triton instance rm INST', {timeout: 10 * 60 * 1000},
            function (t) {
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });
});
