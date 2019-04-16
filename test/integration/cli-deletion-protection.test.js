/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Integration tests for `triton instance enable-deletion-protection ...` and
 * `triton instance disable-deletion-protection ...`
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tap').test;

// --- Globals

var INST_ALIAS = f('nodetritontest-deletion-protection-%s', os.hostname());
var INST;
var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};

// --- Helpers

function cleanup(t) {
    var cmd = 'instance disable-deletion-protection ' + INST_ALIAS + ' -w';

    h.triton(cmd, function (err, stdout, stderr) {
        if (err)
            return t.end();

        h.deleteTestInst(t, INST_ALIAS, function (err2) {
            t.ifErr(err2, 'delete inst err');
            t.end();
        });
    });
}

// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton instance', OPTS, function (suite) {
    h.printConfig(suite);

    suite.test('  cleanup existing inst with alias ' + INST_ALIAS, cleanup);


    suite.test('  triton create --deletion-protection', function (t) {
        h.createTestInst(t, INST_ALIAS, {
            extraFlags: ['--deletion-protection']
        }, function onInst(err2, instId) {
            if (h.ifErr(t, err2, 'triton instance create'))
                return t.end();

            INST = instId;

            h.triton('instance get -j ' + INST, function (err3, stdout) {
                if (h.ifErr(t, err3, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout);
                t.ok(inst.deletion_protection, 'deletion_protection');

                t.end();
            });
        });
    });


    suite.test('  attempt to delete deletion-protected instance', function (t) {
        var cmd = 'instance rm ' + INST + ' -w';

        h.triton(cmd, function (err, stdout, stderr) {
            t.ok(err, 'err expected');
            /* JSSTYLED */
            t.ok(stderr.match(/Instance has "deletion_protection" enabled/));
            t.end();
        });
    });


    suite.test('  triton instance disable-deletion-protection', function (t) {
        var cmd = 'instance disable-deletion-protection ' + INST + ' -w';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance disable-deletion-protection'))
                return t.end();

            t.ok(stdout.match('Disabled deletion protection for instance "' +
                INST + '"'), 'deletion protection disabled');

            h.triton('instance get -j ' + INST, function (err2, stdout2) {
                if (h.ifErr(t, err2, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout2);
                t.ok(!inst.deletion_protection, 'deletion_protection');

                t.end();
            });
        });
    });


    suite.test('  triton inst disable-deletion-protection (already enabled)',
    function (t) {
        var cmd = 'instance disable-deletion-protection ' + INST + ' -w';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance disable-deletion-protection'))
                return t.end();

            t.ok(stdout.match('Disabled deletion protection for instance "' +
                INST + '"'), 'deletion protection disabled');

            h.triton('instance get -j ' + INST, function (err2, stdout2) {
                if (h.ifErr(t, err2, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout2);
                t.ok(!inst.deletion_protection, 'deletion_protection');

                t.end();
            });
        });
    });


    suite.test('  triton instance enable-deletion-protection', function (t) {
        var cmd = 'instance enable-deletion-protection ' + INST + ' -w';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance enable-deletion-protection'))
                return t.end();

            t.ok(stdout.match('Enabled deletion protection for instance "' +
                INST + '"'), 'deletion protection enabled');

            h.triton('instance get -j ' + INST, function (err2, stdout2) {
                if (h.ifErr(t, err2, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout2);
                t.ok(inst.deletion_protection, 'deletion_protection');

                t.end();
            });
        });
    });


    suite.test('  triton instance enable-deletion-protection (already enabled)',
    function (t) {
        var cmd = 'instance enable-deletion-protection ' + INST + ' -w';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance enable-deletion-protection'))
                return t.end();

            t.ok(stdout.match('Enabled deletion protection for instance "' +
                INST + '"'), 'deletion protection enabled');

            h.triton('instance get -j ' + INST, function (err2, stdout2) {
                if (h.ifErr(t, err2, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout2);
                t.ok(inst.deletion_protection, 'deletion_protection');

                t.end();
            });
        });
    });


    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    suite.test('  cleanup: triton rm INST', {timeout: 10 * 60 * 1000}, cleanup);

    suite.end();
});
