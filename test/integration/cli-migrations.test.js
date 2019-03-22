/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/*
 * Integration tests for `triton instance migration ...`
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tape');

// --- Globals

var INST_ALIAS = f('nodetritontest-migrations-%s', os.hostname());
var INST;
var INST_SHORT;
var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};

// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

function getMigrFromList(inst, cb) {
    var cmd = 'instance migration list -j';
    h.triton(cmd, function listMigr(listErr, migrations) {
        if (listErr) {
            cb(listErr);
            return;
        }

        migrations = h.jsonStreamParse(migrations);

        var migration = migrations.filter(function (migr) {
            return (migr.machine === inst);
        }).shift();

        cb(null, migration);
    });
}

function waitForMigrPhase(inst, phase, cb) {
    var maxAttempts = process.env.MAX_ATTEMPTS || 120;
    var currAttempt = 0;

    getMigrFromList(inst, function getCb(listErr, migr) {
        if (listErr) {
            cb(listErr);
            return;
        }

        currAttempt += 1;

        var ready = migr && migr.phase === phase &&
                    migr.progress_history &&
                    migr.progress_history.some(function (step) {
                        return step.phase === phase &&
                            (step.state === 'success' ||
                                step.state === 'failed');
                    });

        if (!ready) {
            if (currAttempt < maxAttempts) {
                setTimeout(function () {
                    waitForMigrPhase(inst, phase, cb);
                }, (process.env.POLL_INTERVAL || 500));
            } else {
                cb(new Error('Timeout waiting for ' + inst));
            }
            return;
        }

        cb(null);
    });
}

test('triton instance migration', OPTS, function (tt) {
    h.printConfig(tt);

    tt.test('  cleanup existing inst with alias ' + INST_ALIAS, function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    tt.test('  setup: triton instance create', function (t) {
        h.createTestInst(t, INST_ALIAS, {}, function onInst(err2, instId) {
            if (h.ifErr(t, err2, 'triton instance create')) {
                t.end();
                return;
            }

            INST = instId;
            INST_SHORT = instId.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    tt.test('  triton instance migration begin', function (t) {
        var cmd = 'instance migration begin ' + INST_SHORT;

        h.triton(cmd, function beginMigrationCb(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance migration begin')) {
                t.end();
                return;
            }
            t.ok(stdout.match('Initiated migration of instance ' + INST_SHORT),
                 'begin migration executed');

            t.end();
        });
    });

    tt.test('  triton wait for migration begin', function (t) {
        waitForMigrPhase(INST, 'begin', function (err) {
            if (h.ifErr(t, err, 'wait for instance migration begin')) {
                t.end();
                return;
            }
            t.end();
        });
    });


    tt.test('  triton instance migration list', function (t) {
        var cmd = 'instance migration list';

        h.triton(cmd, function listMigrationCb(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance migration list')) {
                t.end();
                return;
            }
            var migrs = stdout.split('\n');
            t.ok(migrs[0].match(/SHORTID\s+PHASE\s+STATE\s+AGE/));
            migrs.shift();

            t.ok(migrs.length >= 1, 'triton migrs list expected migrs num');

            var testMigr = migrs.filter(function (migr) {
                return migr.match(INST_SHORT);
            });

            t.equal(testMigr.length, 1, 'triton migrs list test migr found');

            t.end();
        });
    });

    tt.test('  triton instance migration sync', function (t) {
        var cmd = 'instance migration sync ' + INST_SHORT;

        h.triton(cmd, function syncCb(err, stdout, stderr) {
            if (h.ifErr(t, err, 'instance migration sync')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Synchronizing migration of instance ' +
                INST_SHORT));

            t.end();
        });
    });


    tt.test('  triton wait for migration sync', function (t) {
        waitForMigrPhase(INST, 'sync', function (err) {
            if (h.ifErr(t, err, 'wait for instance migration sync')) {
                t.end();
                return;
            }
            t.end();
        });
    });

    tt.test('  triton instance migration switch', function (t) {
        var cmd = 'instance migration switch ' + INST_SHORT;

        h.triton(cmd, function switchCb(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance migration switch')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Switching to migration of instance ' +
                INST_SHORT, 'switching migration'));

            t.end();
        });
    });

    tt.test('  triton wait for migration switch', function (t) {
        waitForMigrPhase(INST, 'switch', function (err) {
            if (h.ifErr(t, err, 'wait for instance migration switch')) {
                t.end();
                return;
            }
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
