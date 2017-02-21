/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Test volume create command.
 */

var format = require('util').format;
var os = require('os');
var test = require('tape');
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');

var testOpts = {
    skip: !h.CONFIG.allowWriteActions
};

test('triton volume create ...', testOpts, function (tt) {
    var validVolumeName =
            h.makeResourceName('node-triton-test-volume-create-default');

    tt.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        tt.comment(format('- %s: %j', key, value));
    });

    tt.test('  cleanup leftover resources', function (t) {
        h.triton(['volume', 'delete', '-w', validVolumeName].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                t.end();
            });
    });

    tt.test('  triton volume create with invalid name', function (t) {
        var invalidVolumeName =
            h.makeResourceName('node-triton-test-volume-create-invalid-name-' +
                '!foo!');
        var expectedErrMsg = 'triton volume create: error (InvalidArgument): ' +
            'Error: Invalid volume name: ' + invalidVolumeName;

        h.triton([
            'volume',
            'create',
            '--name',
            invalidVolumeName
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.equal(stderr.indexOf(expectedErrMsg), 0,
                'stderr should include error message: ' + expectedErrMsg);
            t.end();
        });
    });

    tt.test('  triton volume create with invalid size', function (t) {
        var invalidSize = 'foobar';
        var expectedErrMsg = 'triton volume create: error (InvalidArgument): ' +
            'Error: Invalid volume size: ' + invalidSize;
        var volumeName =
            h.makeResourceName('node-triton-test-volume-create-invalid-size');

        h.triton([
            'volume',
            'create',
            '--name',
            volumeName,
            '--size',
            invalidSize
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.equal(stderr.indexOf(expectedErrMsg), 0,
                'stderr should include error message: ' + expectedErrMsg);
            t.end();
        });
    });

    tt.test('  triton volume create with invalid type', function (t) {
        var invalidType = 'foobar';
        var volumeName =
            h.makeResourceName('node-triton-test-volume-create-invalid-type');
        var expectedErrMsg = 'triton volume create: error (InvalidArgument): ' +
            'Error: Invalid volume type: ' + invalidType;

        h.triton([
            'volume',
            'create',
            '--name',
            volumeName,
            '--type',
            invalidType
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.equal(stderr.indexOf(expectedErrMsg), 0,
                'stderr should include error message: ' + expectedErrMsg);
            t.end();
        });
    });

    tt.test('  triton volume create with invalid network', function (t) {
        var volumeName =
            h.makeResourceName('node-triton-test-volume-create-invalid-' +
                'network');
        var invalidNetwork = 'foobar';
        var expectedErrMsg =
            'triton volume create: error: first of 1 error: no network with ' +
                'name or short id "' + invalidNetwork + '" was found';

        h.triton([
            'volume',
            'create',
            '--name',
            volumeName,
            '--network',
            invalidNetwork
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.equal(stderr.indexOf(expectedErrMsg), 0,
                'stderr should include error message: ' + expectedErrMsg);
            t.end();
        });
    });

    tt.test('  triton volume create valid volume', function (t) {
        h.triton([
            'volume',
            'create',
            '--name',
            validVolumeName,
            '-w'
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.equal(volCreateErr, null,
                'volume creation should not error');
            t.end();
        });
    });

    tt.test('  check volume was created', function (t) {
        h.safeTriton(t, ['volume', 'get', validVolumeName],
            function onGetVolume(getVolErr, stdout) {
                t.equal(getVolErr, null,
                    'Getting volume should not error');
                t.end();
            });
    });

    tt.test('  delete volume', function (t) {
        h.triton(['volume', 'delete', '-w', validVolumeName].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                t.equal(delVolErr, null,
                    'Deleting volume should not error');
                t.end();
            });
    });

    tt.test('  check volume was deleted', function (t) {
        h.triton(['volume', 'get', validVolumeName].join(' '),
            function onGetVolume(getVolErr, stdout, stderr) {
                t.ok(getVolErr,
                    'Getting volume ' + validVolumeName + 'after deleting it ' +
                        'should errorr');
                t.notEqual(stderr.indexOf('ResourceNotFound'), -1,
                    'Getting volume ' + validVolumeName + 'should not find it');
                t.end();
            });
    });

});
