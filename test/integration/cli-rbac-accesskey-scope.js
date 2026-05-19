/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * Integration tests for the per-bucket scope surface of
 * `triton rbac accesskey ...` (RBAC sub-user access keys).
 *
 * Mirrors cli-accesskeys-scope.js for the
 * /:account/users/:user/accesskeys/... CloudAPI routes.
 *
 * Covers:
 *   - rbac accesskey -c --scope=JSON     (round-trip)
 *   - rbac accesskey -c --scope=@FILE    (file source)
 *   - rbac accesskey -c --scope='not...' (local UsageError)
 *   - rbac accesskey -u --scope='{...}'  (replace scope)
 *   - rbac accesskey -u --remove-scope   (clear scope)
 *   - rbac accesskeys -l                 (scope column present)
 *
 * Scope validation rules (envelope shape, wildcards, level enum,
 * size limits) are exercised server-side in sdc-cloudapi /
 * node-mahi tests; this suite only verifies that node-triton
 * shuttles the scope correctly through the rbac CLI surface.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var backoff = require('backoff');
var test = require('tap').test;

var h = require('./helpers');

var MAX_CHECK_KEY_TRIES = 10;

var scopedKey = null;

var SCOPE_RO = {
    version: 1,
    permissions: [
        { bucket: 'test-bucket-ro', level: 'read' }
    ]
};

var SCOPE_RW = {
    version: 1,
    permissions: [
        { bucket: 'test-bucket-ro', level: 'readwrite' }
    ]
};

var testOpts = {
    skip: false
};

if (!h.CONFIG.allowWriteActions) {
    testOpts.skip = 'requires config.allowWriteActions';
}

if (!h.CONFIG.rbacUser) {
    testOpts.skip = 'requires config.rbacUser';
}

var rbacUser = h.CONFIG.rbacUser;


test('triton rbac accesskey scope', testOpts, function (suite) {

    suite.test('--create --scope=JSON round-trips', function (t) {
        var cmd = "rbac accesskey -j --create --scope='" +
            JSON.stringify(SCOPE_RO) + "' " + rbacUser;
        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskey --create --scope=JSON')) {
                return t.end();
            }

            var response = JSON.parse(stdout);
            t.type(response.accesskeyid, 'string', 'response.accesskeyid');
            t.type(response.accesskeysecret, 'string',
                'response.accesskeysecret');
            t.same(response.scope, SCOPE_RO,
                'response.scope deep-equals request');

            delete response.accesskeysecret;
            scopedKey = response;
            t.end();
        });
    });

    suite.test('rbac accesskey get returns the same scope', function (t) {
        var cmd = 'rbac accesskey -j ' + rbacUser + ' ' +
            scopedKey.accesskeyid;
        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskey get')) {
                return t.end();
            }
            var response = JSON.parse(stdout);
            t.same(response.scope, SCOPE_RO,
                'get returns the same scope envelope');
            t.end();
        });
    });

    suite.test('rbac accesskeys -l includes scope column', function (t) {
        h.triton('rbac accesskeys -l ' + rbacUser, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskeys -l')) {
                return t.end();
            }
            t.match(stdout, /\bSCOPE\b/i, 'header has SCOPE column');
            t.end();
        });
    });

    suite.test('--create --scope=@FILE round-trips', function (t) {
        var tmpFile = path.join(os.tmpdir(),
            'triton-rbac-scope-' + process.pid + '-' + Date.now() + '.json');
        fs.writeFileSync(tmpFile, JSON.stringify(SCOPE_RO));

        var cmd = 'rbac accesskey -j --create --scope=@' + tmpFile +
            ' ' + rbacUser;
        h.triton(cmd, function (err, stdout) {
            try {
                fs.unlinkSync(tmpFile);
            } catch (_e) { /* ignore */ }

            if (h.ifErr(t, err, 'rbac accesskey --create --scope=@FILE')) {
                return t.end();
            }

            var response = JSON.parse(stdout);
            t.type(response.accesskeyid, 'string', 'response.accesskeyid');
            t.same(response.scope, SCOPE_RO,
                'file-loaded scope round-trips');

            // Best-effort cleanup of the ephemeral key.
            var delCmd = 'rbac accesskey --delete -f ' + rbacUser + ' ' +
                response.accesskeyid;
            h.triton(delCmd, function () {
                t.end();
            });
        });
    });

    suite.test('--create --scope=<malformed> fails locally', function (t) {
        var cmd = "rbac accesskey --create --scope='not json' " + rbacUser;
        h.triton(cmd, function (err, _stdout, stderr) {
            t.ok(err, 'expected non-zero exit');
            t.match(stderr, /--scope is not valid JSON/,
                'local UsageError surfaces');
            t.end();
        });
    });

    suite.test('--update --scope=<new JSON> replaces scope', function (t) {
        var cmd = 'rbac accesskey --update --scope=\'' +
            JSON.stringify(SCOPE_RW) + '\' ' + rbacUser + ' ' +
            scopedKey.accesskeyid;
        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskey --update --scope')) {
                return t.end();
            }
            t.match(stdout, 'Updated access key ' + scopedKey.accesskeyid);
            t.match(stdout, 'fields: scope');

            var call = backoff.call(function checkScope(next) {
                var getCmd = 'rbac accesskey -j ' + rbacUser + ' ' +
                    scopedKey.accesskeyid;
                h.triton(getCmd, function (err2, stdout2) {
                    if (h.ifErr(t, err2, 'rbac accesskey get')) {
                        return next(err2);
                    }
                    var response = JSON.parse(stdout2);
                    if (!response.scope ||
                        response.scope.permissions[0].level !==
                        'readwrite') {
                        return next(new Error(
                            'scope not yet replicated'));
                    }
                    t.same(response.scope, SCOPE_RW,
                        'updated scope visible via get');
                    return next();
                });
            }, function (err3) {
                h.ifErr(t, err3,
                    'replicated scope not visible after update');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });

    suite.test('--update --remove-scope clears scope', function (t) {
        var cmd = 'rbac accesskey --update --remove-scope ' +
            rbacUser + ' ' + scopedKey.accesskeyid;
        h.triton(cmd, function (err) {
            if (h.ifErr(t, err, 'rbac accesskey --update --remove-scope')) {
                return t.end();
            }

            var call = backoff.call(function checkCleared(next) {
                var getCmd = 'rbac accesskey -j ' + rbacUser + ' ' +
                    scopedKey.accesskeyid;
                h.triton(getCmd, function (err2, stdout) {
                    if (h.ifErr(t, err2, 'rbac accesskey get')) {
                        return next(err2);
                    }
                    var response = JSON.parse(stdout);
                    if (response.scope !== null) {
                        return next(new Error(
                            'scope not yet cleared'));
                    }
                    t.equal(response.scope, null,
                        'scope is null (unrestricted)');
                    return next();
                });
            }, function (err3) {
                h.ifErr(t, err3,
                    'scope clear not visible after update');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });

    suite.test('cleanup: delete scoped key', function (t) {
        var cmd = 'rbac accesskey --delete -f ' + rbacUser + ' ' +
            scopedKey.accesskeyid;
        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskey --delete')) {
                return t.end();
            }
            t.match(stdout, 'Deleted access key "' + scopedKey.accesskeyid);
            t.end();
        });
    });

    suite.end();
});
