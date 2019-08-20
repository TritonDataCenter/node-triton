/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
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
var INST_SHORT;
var USER_MIGR_ALLOWED = true;
var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};

// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton instance migration abort', OPTS, function (tt) {
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

            INST_SHORT = instId.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    tt.test('  triton instance migration begin (try)', {
        timeout: 10 * 60 * 1000
    }, function (t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        var cmd = 'instance migration begin -w ' + INST_SHORT;
        h.triton(cmd, function beginCb(err, stdout, stderr) {
            if (err) {
                if (stderr.match('User migration on this VM not allowed')) {
                    USER_MIGR_ALLOWED = false;
                }
                t.end();
                return;
            }
            t.end();
        });
    });

    tt.test('  triton instance migration abort', {
        timeout: 10 * 60 * 1000
    }, function testMigrAbortCb(t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }

        if (!USER_MIGR_ALLOWED) {
            t.comment('Skipping test. User migration not allowed');
            t.end();
            return;
        }
        var cmd = ['instance', 'migration', 'abort', '-w', INST_SHORT];

        h.safeTriton(t, cmd, function syncCb(err, stdout, stderr) {
            if (err) {
                t.end();
                return;
            }
            t.ok(stdout.match('Done - abort finished'), 'abort');
            t.end();
        });
    });

    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    tt.test('  cleanup: triton instance rm INST', {
        timeout: 10 * 60 * 1000
    }, function (t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });
});

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

            INST_SHORT = instId.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    var actions = ['begin', 'sync', 'switch'];

    actions.forEach(function doTestAction(action) {
        var actCmd = ['instance', 'migration', action ];

        tt.test('  triton ' + actCmd.join(' '), {
            timeout: 10 * 60 * 1000
        }, function testMigrActCb(t) {
            if (!INST_SHORT) {
                t.comment('Skipping test. Instance not created');
                t.end();
                return;
            }

            if (!USER_MIGR_ALLOWED) {
                t.comment('Skipping test. User migration not allowed');
                t.end();
                return;
            }
            var cmd = actCmd.concat(['-w', INST_SHORT]);

            h.safeTriton(t, cmd, function syncCb(err, stdout, stderr) {
                if (err) {
                    t.end();
                    return;
                }
                t.ok(stdout.match('Done - ' + action + ' finished'), action);
                t.end();
            });
        });
    });


    tt.test('  triton instance migration list', function (t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }

        if (!USER_MIGR_ALLOWED) {
            t.comment('Skipping test. User migration not allowed');
            t.end();
            return;
        }

        var cmd = ['instance', 'migration', 'list'];

        h.safeTriton(t, cmd, function listMigrationCb(err, stdout, stderr) {
            if (err) {
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

    tt.test('   triton instance migration get', function (t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }

        if (!USER_MIGR_ALLOWED) {
            t.comment('Skipping test. User migration not allowed');
            t.end();
            return;
        }

        var cmd = ['instance', 'migration', 'get', INST_SHORT];
        h.safeTriton(t, cmd, function getCb(err, stdout, stderr) {
            if (err) {
                t.end();
                return;
            }

            var strs = [
                'State',
                'Created',
                'Automatic',
                'Total runtime',
                'Phases'
            ];
            strs.forEach(function (str) {
                t.ok(stdout.match(str), str);
            });
            t.end();
        });
    });


    tt.test('   triton instance migration finalize', function (t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }

        if (!USER_MIGR_ALLOWED) {
            t.comment('Skipping test. User migration not allowed');
            t.end();
            return;
        }
        var cmd = ['instance', 'migration', 'finalize', INST_SHORT];

        h.safeTriton(t, cmd, function syncCb(err, stdout, stderr) {
            if (err) {
                t.end();
                return;
            }
            t.equal(stdout.trim(), 'Done - the migration is finalized');
            t.end();
        });
    });


    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    tt.test('  cleanup: triton instance rm INST', {
        timeout: 10 * 60 * 1000
    }, function (t) {
        if (!INST_SHORT) {
            t.comment('Skipping test. Instance not created');
            t.end();
            return;
        }
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });
});

// vim: set expandtab softtabstop=4 shiftwidth=4:
