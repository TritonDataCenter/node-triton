/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at hsuitep://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Test disks commands.
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tap').test;

var DISK_ID;
var INST_ALIAS = f('nodetritontest-disks-%s', os.hostname());
var INST;
var OPTS = {
    skip: (!h.CONFIG.allowWriteActions || h.CONFIG.skipFlexDiskTests) &&
        'requires config.allowWriteActions and config.skipFlexDiskTests=false'
};

// --- Tests

test('triton instance disks', OPTS, function (suite) {
    h.printConfig(suite);

    suite.test('  cleanup existing inst with alias ' + INST_ALIAS,
    function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    suite.test('  setup: triton instance create', function (t) {

        var diskOpts = [
            '--disk', JSON.stringify(JSON.stringify({size: 10240})),
            '--disk', JSON.stringify(JSON.stringify({size: 512}))
        ];

        h.createTestFlexInst(t, INST_ALIAS, {extraFlags: diskOpts},
        function onInst(err2, instId) {
            if (h.ifErr(t, err2, 'triton instance create')) {
                t.end();
                return;
            }
            t.ok(instId, 'triton instance create instId');
            if (!instId) {
                t.end();
                return;
            }

            INST = instId.match(/^(.+?)-/)[1]; // convert to short ID
            t.end();
        });
    });

    suite.test('  triton instance disks', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'disks', INST];

        h.safeTriton(t, cmd, function onDisks(err, stdout) {
            if (err) {
                t.end();
                return;
            }

            var disks = stdout.split('\n');
            t.ok(disks[0].match(/SHORTID\s+SIZE/));
            t.strictEqual(disks[1].split(' ')[2], '10240');
            t.strictEqual(disks[2].split(' ')[2], '512');
            t.end();
        });
    });

    suite.test('  stop instance', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'stop', '-w', INST ];

        h.safeTriton(t, cmd, function onStop() {
            t.end();
        });
    });

    suite.test('  triton instance disk add', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'disk', 'add', '-w', INST, '256'];

        h.safeTriton(t, cmd, function onAdd(err, stdout) {
            if (err) {
                t.end();
                return;
            }

            var uuidPattern = new RegExp('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]' +
                '{4}-[0-9a-f]{4}-[0-9a-f]{12}');

            DISK_ID = stdout.match(uuidPattern)[0];
            var lines = stdout.split('\n');

            t.ok(lines[0].match('Adding disk to instance ' + INST),
                'adding disk');
            t.ok(lines[1].match('Added disk "' + DISK_ID + '" in \\d+'),
                'disk added');
            t.end();
        });
    });

    suite.test('  triton instance get added disk', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'disk', 'get', INST, DISK_ID];

        h.safeTriton(t, cmd, function onDisks(err, stdout) {
            if (err) {
                t.end();
                return;
            }

            var disk = JSON.parse(stdout);

            t.strictEqual(disk.size, 256);
            t.strictEqual(disk.id, DISK_ID);
            t.end();
        });
    });

    suite.test('  triton instance disk resize', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'disk', 'resize', '-w', INST, DISK_ID, '512'];

        h.safeTriton(t, cmd, function onAdd(err, stdout) {
            if (err) {
                t.end();
                return;
            }

            var lines = stdout.split('\n');
            t.ok(lines[0].match('Resizing disk "' + DISK_ID + '"'),
                'resizing disk');
            t.ok(lines[1].match('Resized disk "' + DISK_ID + '" in \\d+'),
                'disk added');
            t.end();
        });
    });

    suite.test('  triton instance get resized disk', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'disk', 'get', INST, DISK_ID ];

        h.safeTriton(t, cmd, function onDisks(err, stdout) {
            if (err) {
                t.end();
                return;
            }

            var disk = JSON.parse(stdout);

            t.strictEqual(disk.size, 512);
            t.strictEqual(disk.id, DISK_ID);
            t.end();
        });
    });

    suite.test('  triton instance disk delete', function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = ['instance', 'disk', 'delete', '-w', INST, DISK_ID];

        h.safeTriton(t, cmd, function onDisks(err, stdout) {
            if (err) {
                t.end();
                return;
            }

            var lines = stdout.split('\n');
            t.ok(lines[0].match('Deleting disk "' + DISK_ID + '" from instance '
                + INST), 'deleting disk');
            t.ok(lines[1].match('Deleted disk "' + DISK_ID + '" in \\d+'),
                'disk deleted');
            t.end();
        });
    });


    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * a suite attempt failed or if it is just taking a really long time.
     */
    suite.test('  cleanup: triton instance rm INST', {timeout: 10 * 60 * 1000},
    function (t) {
        if (!INST) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });

    suite.end();
});
