/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Integration tests for `triton instance snapshot ...`
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tap').test;

// --- Globals

var SNAP_NAME = 'test-snapshot';
var INST_ALIAS = f('nodetritontest-snapshots-%s', os.hostname());
var INST;
var SNAP_OK;

var testOpts = {
    skip: (
        (!h.CONFIG.allowWriteActions && 'requires config.allowWriteActions')
    )
};

// --- Tests

test('triton instance snapshot', testOpts, function (suite) {
    h.printConfig(suite);

    suite.test('  cleanup existing inst with alias ' + INST_ALIAS,
    function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    suite.test('  setup: triton instance create', function (t) {
        h.createTestInst(t, INST_ALIAS, {}, function onInst(err2, instId) {
            if (h.ifErr(t, err2, 'triton instance create')) {
                t.end();
                return;
            }

            INST = instId.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    /*
     * Trying to test snapshot deletion after rolling back a VM to that
     * snapshot will result into the following `vmadm` error:
     *
     * Command failed: umount: warning:
     * /zones/$vm_uuid/root//checkpoints/$snap_name not in mnttab
     *
     * Given our goal here is just to test node-triton cli commands, safer
     * approach is to perform deletion testing before we boot the VM from
     * a snapshot
     */
    suite.test('  triton instance snapshot create (2)', function (t) {
        if (!INST) {
            t.end();
            return;
        }
        var cmd = 'instance snapshot create -w -n ' + SNAP_NAME + '-2 ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot create')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Created snapshot "' + SNAP_NAME + '-2" in \\d+'),
                 'snapshot made');

            t.end();
        });
    });

    suite.test('  triton instance snapshot get (2)', function (t) {
        if (!INST) {
            t.end();
            return;
        }
        var cmd = 'instance snapshot get ' + INST + ' ' + SNAP_NAME + '-2';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot get')) {
                SNAP_OK = false;
                t.end();
                return;
            }

            var obj = JSON.parse(stdout);
            t.equal(obj.name, SNAP_NAME + '-2', 'snapshot name is correct');
            t.equal(obj.state, 'created', 'snapshot was properly created');
            SNAP_OK = true;
            t.end();
        });
    });

    suite.test('  triton instance snapshot delete', function (t) {
        if (!SNAP_OK) {
            t.end();
            return;
        }

        SNAP_OK = false;

        var cmd = 'instance snapshot delete  -w --force ' + INST + ' ' +
                  SNAP_NAME + '-2';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot delete')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Deleting snapshot "' + SNAP_NAME + '-2"',
                 'deleting snapshot'));
            t.ok(stdout.match('Deleted snapshot "' + SNAP_NAME + '-2" in \\d+s',
                 'deleted snapshot'));

            t.end();
        });
    });

    suite.test('  triton instance snapshot create', function (t) {
        if (!INST) {
            t.end();
            return;
        }
        var cmd = 'instance snapshot create -w -n ' + SNAP_NAME + ' ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot create')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Created snapshot "' + SNAP_NAME + '" in \\d+'),
                 'snapshot made');

            t.end();
        });
    });

    suite.test('  triton instance snapshot get', function (t) {
        if (!INST) {
            t.end();
            return;
        }
        var cmd = 'instance snapshot get ' + INST + ' ' + SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot get')) {
                t.end();
                return;
            }

            var obj = JSON.parse(stdout);
            t.equal(obj.name, SNAP_NAME, 'snapshot name is correct');
            t.equal(obj.state, 'created', 'snapshot was properly created');
            SNAP_OK = true;
            t.end();
        });
    });

    suite.test('  triton instance snapshot list', function (t) {
        if (!INST) {
            t.end();
            return;
        }
        var cmd = 'instance snapshot list ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance snapshot list')) {
                t.end();
                return;
            }

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

    suite.test('  triton instance start --snapshot', function (t) {
        if (!SNAP_OK) {
            t.end();
            return;
        }
        var cmd = 'instance start ' + INST + ' -w --snapshot=' + SNAP_NAME;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance start --snapshot')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Start instance ' + INST));

            t.end();
        });
    });

    suite.test('  cleanup: triton instance rm INST', function (t) {
        if (!INST) {
            t.end();
            return;
        }
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });

    suite.end();
});
