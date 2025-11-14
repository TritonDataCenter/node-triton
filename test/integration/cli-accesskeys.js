/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 */

/*
 * Integration tests for `triton accesskeys ...`
 */

var h = require('./helpers');
var test = require('tap').test;
var backoff = require('backoff');

var MAX_CHECK_KEY_TRIES = 10;

// Set by `triton accesskeys create` and used by other tests
var accessKey = null;

var testOpts = {
    skip: false
};

if (!h.CONFIG.allowWriteActions) {
    testOpts.skip = 'requires config.allowWriteActions';
}

test('triton accesskey', testOpts, function (suite) {
    suite.test('accesskeys create', function (t) {
        h.triton('accesskeys create -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'accesskeys create')) {
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

    suite.test('accesskeys get', function (t) {
        h.triton('accesskeys get -j ' + accessKey.accesskeyid,
            function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'accesskeys get')) {
                return t.end();
            }
            var response = JSON.parse(stdout);
            t.same(response, accessKey, 'response == accesskey');
            t.end();
        });
    });

    suite.test('accesskeys list', function (t) {
        var call = backoff.call(function findAccessKey(next) {
            h.triton('accesskeys list -j', function (err, stdout, stderr) {
                if (h.ifErr(t, err, 'accesskeys list')) {
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
                'triton accesskeys list did not return access key');
            t.end();
        });

        call.failAfter(MAX_CHECK_KEY_TRIES);
        call.start();
    });

    suite.test('accesskeys update', function (t) {
        var status = 'Inactive';
        var desc = 'Some Desc';
        var cmd = 'accesskeys update ' + accessKey.accesskeyid +
            ' status=' + status + ' description="' + desc + '"';

        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'accesskeys update')) {
                return t.end();
            }
            t.match(stdout, 'Updated access key ' + accessKey.accesskeyid);
            t.match(stdout, 'fields: status, description');

            var call = backoff.call(function findAccessKey(next) {
                h.triton('accesskeys get -j ' + accessKey.accesskeyid,
                    function (err2, stdout2) {

                    if (h.ifErr(t, err2, 'accesskeys get')) {
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
                    'triton accesskeys get failed to return access key');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });

    suite.test('accesskeys delete', function (t) {
        var cmd = 'accesskeys delete -f ' + accessKey.accesskeyid;

        h.triton(cmd, function (err, stdout) {
            if (h.ifErr(t, err, 'accesskeys delete')) {
                return t.end();
            }
            t.match(stdout, 'Deleted access key "' + accessKey.accesskeyid);

            var call = backoff.call(function findAccessKey(next) {
                h.triton('accesskeys get ' + accessKey.accesskeyid,
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
                    'triton accesskeys delete did not delete access key');
                t.end();
            });

            call.failAfter(MAX_CHECK_KEY_TRIES);
            call.start();
        });
    });

    suite.end();
});
