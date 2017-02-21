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

var FABRIC_NETWORKS = [];

var testOpts = {
    skip: !h.CONFIG.allowWriteActions
};
test('triton volume create ...', testOpts, function (tt) {
    var currentVolume;
    var validVolumeName =
            h.makeResourceName('node-triton-test-volume-create-default');

    tt.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        tt.comment(format('- %s: %j', key, value));
    });

    tt.test('  cleanup leftover resources', function (t) {
        h.triton(['volume', 'delete', '-y', '-w', validVolumeName].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                // If there was nothing to delete, this will fail so that's the
                // normal case. Too bad we don't have a --force option.
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
            t.ok(volCreateErr, 'create should have failed' +
                (volCreateErr ? '' : ', but succeeded'));
            t.equal(stderr.indexOf(expectedErrMsg), 0,
                'stderr should include error message: ' + expectedErrMsg);
            t.end();
        });
    });

    tt.test('  triton volume create with invalid size', function (t) {
        var invalidSize = 'foobar';
        var expectedErrMsg = 'triton volume create: error: size "' +
            invalidSize + '" is not a valid volume size';
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
        var expectedErrMsg = 'no network with name or short id "' +
            invalidNetwork + '" was found';

        h.triton([
            'volume',
            'create',
            '--name',
            volumeName,
            '--network',
            invalidNetwork
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.notEqual(stderr.indexOf(expectedErrMsg), -1,
                'stderr should include error message: ' + expectedErrMsg +
                ', got: ' + volCreateErr);
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
        h.triton(['volume', 'delete', '-y', '-w', validVolumeName].join(' '),
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
                        'should error');
                t.notEqual(stderr.indexOf('ResourceNotFound'), -1,
                    'Getting volume ' + validVolumeName + 'should not find it');
                t.end();
            });
    });

    // Test that we can create a volume with a valid fabric network and the
    // volume ends up on that network.

    tt.test('  find fabric network', function (t) {
        h.triton(['network', 'list', '-j'].join(' '),
            function onGetNetworks(getNetworksErr, stdout, stderr) {
                var resultsObj;

                t.ifErr(getNetworksErr, 'should succeed getting network list');

                // turn the JSON lines into a JSON object
                resultsObj = JSON.parse('[' + stdout.trim().replace(/\n/g, ',')
                    + ']');

                t.ok(resultsObj.length > 0,
                    'should find at least 1 network, found '
                    + resultsObj.length);

                FABRIC_NETWORKS = resultsObj.filter(function fabricFilter(net) {
                    // keep only those networks that are marked as fabric=true
                    return (net.fabric === true);
                });

                t.ok(FABRIC_NETWORKS.length > 0,
                    'should find at least 1 fabric network, found '
                    + FABRIC_NETWORKS.length);

                t.end();
            });
    });

    tt.test('  triton volume on fabric network', function (t) {
        h.triton([
            'volume',
            'create',
            '--name',
            'node-triton-test-volume-create-fabric-network',
            '--network',
            FABRIC_NETWORKS[0].id,
            '-w',
            '-j'
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.ifErr(volCreateErr, 'volume creation should succeed');
            t.comment('stdout: ' + stdout);
            t.comment('stderr: ' + stderr);
            currentVolume = JSON.parse(stdout);
            t.end();
        });
    });

    tt.test('  check volume was created', function (t) {
        h.safeTriton(t, ['volume', 'get', currentVolume.name],
            function onGetVolume(getVolErr, stdout) {
                var volumeObj;

                t.ifError(getVolErr, 'getting volume should succeed');

                volumeObj = JSON.parse(stdout);
                t.equal(volumeObj.networks[0], FABRIC_NETWORKS[0].id,
                    'expect network to match fabric we passed');

                t.end();
            });
    });

    tt.test('  delete volume', function (t) {
        h.triton(['volume', 'delete', '-y', '-w', currentVolume.name].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                t.ifError(delVolErr, 'deleting volume should succeed');
                t.end();
            });
    });

});
