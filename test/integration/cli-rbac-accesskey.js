/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/*
 * Integration tests for `triton rbac accesskeys ...`
 */

var h = require('./helpers');
var test = require('tap').test;
var backoff = require('backoff');

var MAX_CHECK_KEY_TRIES = 10;

// Set by `triton accesskeys create` and used by other tests
var accesskey = null;

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

var accessKey = null;

test('triton rbac accesskey', testOpts, function (suite) {

    suite.test('rbac accesskey --create', function (t) {

        h.triton('rbac accesskey -j --create ' + rbacUser,
            function (err, stdout, stderr) {

            if (h.ifErr(t, err, 'rbac accesskey --create')) {
                return t.end();
            }

            var response = JSON.parse(stdout);
            t.type(response.accesskeyid, 'string', 'response.accesskeyid');
            t.type(response.accesskeysecret, 'string',
                'response.accesskeysecret');
            t.type(response.status, 'string', 'response.status');
            t.type(response.created, 'string', 'response.created');
            t.type(response.updated, 'string', 'response.updated');
            t.equal(response.created, response.updated,
                'response.created == response.updated');

            delete response.accesskeysecret;
            accessKey = response;

            t.end();
        });
    });

    suite.test('rbac accesskey', function (t) {
        h.triton('rbac accesskey -j ' + rbacUser + ' ' + accessKey.accesskeyid,
            function (err, stdout, stderr) {

            if (h.ifErr(t, err, 'rbac accesskey')) {
                return t.end();
            }
            var response = JSON.parse(stdout);
            t.same(response, accessKey, 'response == accesskey');
            t.end();
        });
    });

    suite.test('rbac accesskeys', function (t) {
        var call = backoff.call(function findAccessKey(next) {
            h.triton('rbac accesskeys -j ' + rbacUser,
                function (err, stdout, stderr) {

                if (h.ifErr(t, err, 'rbac accesskeys')) {
                    return next(err);
                }

                var found = stdout.split('\n')
                    .filter(function (line) {
                        return line;
                    })
                    .map(function (line) {
                        return JSON.parse(line);
                    })
                    .find(function (k) {
                        return (k.accesskeyid === accessKey.accesskeyid);
                    });

                if (!found) {
                    var msg = 'Missing access key: ' + accessKey.accesskeyid;
                    return next(new Error(msg));
                } else {
                    t.ok(found, 'Found access key');
                    t.end();
                }
            });
        }, function (err2) {
            h.ifErr(t, err2,
                'rbac accesskeys did not return access key');
            t.end();
        });

        call.failAfter(MAX_CHECK_KEY_TRIES);
        call.start();
    });

    suite.test('rbac accesskey --update', function (t) {
        var status = 'Inactive';
        var desc = 'Some Desc';
        var cmd = 'rbac accesskey --update ' + rbacUser + ' ' +
            accessKey.accesskeyid + ' -s ' + status + ' -D "' + desc + '"';

        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskey --update')) {
                return t.end();
            }
            t.match(stdout, 'Updated access key ' + accessKey.accesskeyid);
            t.match(stdout, 'fields: status, description');

            var call = backoff.call(function findAccessKey(next) {
                h.triton('rbac accesskey -j ' + rbacUser + ' ' +
                    accessKey.accesskeyid,
                    function (err2, stdout2) {

                    if (h.ifErr(t, err2, 'rbac accesskey')) {
                        return next(err2);
                    }

                    const response = JSON.parse(stdout2);

                    if (response.status !== status &&
                        response.description !== desc) {
                        return next(new Error('access key not updated'));
                    }
                    t.equal(response.status, status);
                    t.equal(response.description, desc);
                    return next();
                });
            }, function (err3) {
                h.ifErr(t, err3,
                    'triton rbac accesskey failed to return access key');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });

    suite.test('rbac accesskey --delete', function (t) {
        var cmd = 'rbac accesskey --delete -f ' + rbacUser + ' ' +
            accessKey.accesskeyid;

        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'rbac accesskey --delete')) {
                return t.end();
            }
            t.match(stdout, 'Deleted access key "' + accessKey.accesskeyid);

            var call = backoff.call(function findAccessKey(next) {
                h.triton('rbac accesskey -j ' + rbacUser + ' ' +
                    accessKey.accesskeyid,
                    function (err2, _stdout, stderr) {

                    if (!err2) {
                        return next(new Error('access key still exists'));
                    }

                    t.match(stderr, '(ResourceNotFound): ' +
                        accessKey.accesskeyid);
                    return next();
                });
            }, function (err3) {
                h.ifErr(t, err3,
                    'triton rbac accesskey --delete did not delete access key');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });

    suite.end();
});
