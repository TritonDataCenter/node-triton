/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Test volume create command.
 */

var format = require('util').format;
var os = require('os');
var test = require('tap').test;
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');

var testOpts = {
    skip: (
        !(h.CONFIG.allowWriteActions && h.CONFIG.allowVolumesTests) &&
        'requires config.allowWriteActions and config.allowVolumesTests'
    )
};
var FABRIC_NETWORKS = [];


test('triton volume create ...', testOpts, function (suite) {
    var affinitySupported = false;
    var currentVolume;
    var tagsSupported = false;
    var validVolumeName =
            h.makeResourceName('node-triton-test-volume-create-default');

    suite.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        suite.comment(format('- %s: %j', key, value));
    });

    suite.test('  check cloudapi version', function (t) {
        h.cloudapiVersionGtrOrEq('9.8.6', function (verErr, supported) {
            t.ifErr(verErr, 'cloudapi version check should not fail');
            affinitySupported = supported;
            // Tags came in at the same time as affinity.
            tagsSupported = supported;
            t.end();
        });
    });

    suite.test('  cleanup leftover resources', function (t) {
        h.triton(['volume', 'delete', '-y', '-w', validVolumeName].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                // If there was nothing to delete, this will fail so that's the
                // normal case. Too bad we don't have a --force option.
                t.end();
            });
    });

    suite.test('  triton volume create with invalid name', function (t) {
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

    suite.test('  triton volume create with invalid size', function (t) {
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

    suite.test('  triton volume create with invalid type', function (t) {
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

    suite.test('  triton volume create with invalid network', function (t) {
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

    suite.test('  triton volume create with invalid affinity', function (t) {
        if (!affinitySupported) {
            t.ok(true, 'SKIPPED - affinity not supported');
            t.end();
            return;
        }

        var volumeName =
            h.makeResourceName('node-triton-test-volume-create-invalid-' +
                'affinity');
        var invalidAffinity = 'foobar';
        var expectedErrMsg = 'could not find operator in affinity rule';

        h.triton([
            'volume',
            'create',
            '--name',
            volumeName,
            '--affinity',
            invalidAffinity
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.notEqual(stderr.indexOf(expectedErrMsg), -1,
                'stderr should include error message: ' + expectedErrMsg +
                ', got: ' + volCreateErr);
            t.end();
        });
    });

    suite.test('  triton volume create with invalid tags', function (t) {
        var volumeName =
            h.makeResourceName('node-triton-test-volume-create-invalid-' +
                'tags');
        var invalidTag = 'foobar';
        var expectedErrMsg = 'invalid KEY=VALUE tag argument: ' + invalidTag;

        h.triton([
            'volume',
            'create',
            '--name',
            volumeName,
            '--tag',
            invalidTag
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.notEqual(stderr.indexOf(expectedErrMsg), -1,
                'stderr should include error message: ' + expectedErrMsg +
                ', got: ' + volCreateErr);
            t.end();
        });
    });

    suite.test('  triton volume create valid volume', function (t) {
        h.triton([
            'volume',
            'create',
            '--name',
            validVolumeName,
            '--tag',
            'role=volume',
            '--affinity',
            'sometag!=nosuchtag',
            '-w'
        ].join(' '), function (volCreateErr, stdout, stderr) {
            t.equal(volCreateErr, null,
                'volume creation should not error');
            t.end();
        });
    });

    suite.test('  check volume was created', function (t) {
        h.safeTriton(t, ['volume', 'get', '--json', validVolumeName],
            function onGetVolume(getVolErr, stdout) {
                t.equal(getVolErr, null,
                    'Getting volume should not error');

                if (getVolErr) {
                    t.end();
                    return;
                }

                // Check volume properties.
                var volume = JSON.parse(stdout);
                t.equal(volume.name, validVolumeName, 'check volume name');
                t.equal(volume.type, 'tritonnfs', 'check volume type');

                // Check volume tags when cloudapi supports it.
                if (tagsSupported) {
                    t.deepEqual(volume.tags, {'role': 'volume'},
                    'check volume tags');
                }

                t.end();
            });
    });

    suite.test('  delete volume', function (t) {
        h.triton(['volume', 'delete', '-y', '-w', validVolumeName].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                t.equal(delVolErr, null,
                    'Deleting volume should not error');
                t.end();
            });
    });

    suite.test('  check volume was deleted', function (t) {
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

    suite.test('  find fabric network', function (t) {
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

    suite.test('  triton volume on fabric network', function (t) {
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

    suite.test('  check volume was created', function (t) {
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

    suite.test('  delete volume', function (t) {
        h.triton(['volume', 'delete', '-y', '-w', currentVolume.name].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                t.ifError(delVolErr, 'deleting volume should succeed');
                t.end();
            });
    });

    suite.end();
});
