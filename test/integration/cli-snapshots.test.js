/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Integration tests for `triton snapshot ...`
 */

var h = require('./helpers');
var test = require('tape');

// --- Globals

var SNAP_NAME = 'test-snapshot';
var INST;

// --- Tests

test('triton snapshot', function (tt) {
    tt.test('setup', function (t) {
        h.triton('insts -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton insts'))
                return t.end();

            var rows = stdout.split('\n');
            INST = JSON.parse(rows[0]).id;
            t.ok(INST);

            t.end();
        });
    });

    tt.test(' triton snapshot create', function (t) {
        var cmd = 'snapshot create -w -n ' + SNAP_NAME + ' ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton snapshot create'))
                return t.end();

            t.ok(stdout.match('Created snapshot "' + SNAP_NAME + '" in \\d+'),
                 'snapshot made');

            t.end();
        });
    });

    tt.test(' triton snapshot get', function (t) {
        var cmd = 'snapshot get ' + INST + ' ' + SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton snapshot get'))
                return t.end();

            var obj = JSON.parse(stdout);
            t.equal(obj.name, SNAP_NAME, 'snapshot name is correct');
            t.equal(obj.state, 'created', 'snapshot was properly created');

            t.end();
        });
    });

    tt.test(' triton snapshot list', function (t) {
        h.triton('snapshot list ' + INST, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton snapshot list'))
                return t.end();

            var snaps = stdout.split('\n');
            t.ok(snaps[0].match(/NAME\s+STATE/));
            snaps.shift();

            t.ok(snaps.length >= 1, 'triton snap list expected snap num');

            var testSnaps = snaps.filter(function (snap) {
                return snap.match(SNAP_NAME);
            });

            t.equal(testSnaps.length, 1, 'triton snap list test snap found');

            t.end();
        });
    });

    tt.test(' triton instance start --snapshot', function (t) {
        var cmd = 'instance start ' + INST + ' -w --snapshot=' + SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance start --snapshot'))
                return t.end();

            t.ok(stdout.match('Start instance ' + INST));

            t.end();
        });
    });

    tt.test(' triton snapshot delete', function (t) {
        var cmd = 'snapshot delete ' + INST + ' ' + SNAP_NAME + ' -w --force';
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton snapshot delete'))
                return t.end();

            t.ok(stdout.match('Deleting snapshot "' + SNAP_NAME + '"',
                 'deleting snapshot'));
            t.ok(stdout.match('Deleted snapshot "' + SNAP_NAME + '" in \\d+s',
                 'deleted snapshot'));

            t.end();
        });
    });
});
