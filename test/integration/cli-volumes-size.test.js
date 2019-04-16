/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Test volume create command's size parameter.
 */

var format = require('util').format;
var os = require('os');
var test = require('tap').test;
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');
var mod_volumes = require('../../lib/volumes');

var FABRIC_NETWORKS = [];
var MIBS_IN_GIB = 1024;

var testOpts = {
    skip: !(h.CONFIG.allowWriteActions && h.CONFIG.allowVolumesTests)
};
if (testOpts.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" and "allowVolumesTests" '
        + 'in test config to enable');
}

test('triton volume create with non-default size...', testOpts,
function (suite) {
    var validVolumeName =
            h.makeResourceName('node-triton-test-volume-create-non-default-' +
                'size');
    var validVolumeSize = '20G';
    var validVolumeSizeInMib = 20 * 1024;

    suite.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        suite.comment(format('- %s: %j', key, value));
    });

    suite.test('  cleanup leftover resources', function (t) {
        h.triton(['volume', 'delete', '-y', '-w', validVolumeName].join(' '),
            function onDelVolume(delVolErr, stdout, stderr) {
                // If there was nothing to delete, this will fail so that's the
                // normal case. Too bad we don't have a --force option.
                t.end();
            });
    });

    suite.test('  triton volume create volume with non-default size',
        function (t) {
            h.triton([
                'volume',
                'create',
                '--name',
                validVolumeName,
                '--size',
                validVolumeSize,
                '-w'
            ].join(' '), function (volCreateErr, stdout, stderr) {
                t.equal(volCreateErr, null,
                    'volume creation should not error');
                t.end();
            });
        });

    suite.test('  check volume was created', function (t) {
        h.safeTriton(t, ['volume', 'get', validVolumeName],
            function onGetVolume(getVolErr, stdout) {
                var volume;

                t.equal(getVolErr, null,
                    'Getting volume should not error');

                volume = JSON.parse(stdout);
                t.equal(volume.size, validVolumeSizeInMib,
                    'volume size should be ' + validVolumeSizeInMib +
                        ', got: ' + volume.size);
                t.end();
            });
    });

    suite.test('  delete volume', function (t) {
        h.safeTriton(t, ['volume', 'delete', '-y', '-w', validVolumeName],
            function onDelVolume(delVolErr, stdout) {
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

    suite.end();
});

test('triton volume create with unavailable size...', testOpts,
function (suite) {
    var validVolumeName =
            h.makeResourceName('node-triton-test-volume-create-unavailable-' +
                'size');

    suite.test('  triton volume create volume with unavailable size',
        function (t) {

            vasync.pipeline({arg: {}, funcs: [
                function getVolumeSizes(ctx, next) {
                    h.triton(['volume', 'sizes', '-j'],
                        function onVolSizesListed(volSizesListErr, sizes) {
                            var largestSizeInMib;

                            t.notOk(volSizesListErr,
                                    'listing volume sizes should not error');
                            if (volSizesListErr) {
                                next(volSizesListErr);
                                return;
                            }

                            t.ok(typeof (sizes) === 'string',
                                'sizes should be a string');

                            sizes = sizes.trim().split('\n');
                            t.ok(sizes.length > 0,
                                'there should be at least one available ' +
                                    'volume size');

                            if (sizes.length === 0) {
                                next(new Error('no volume size available'));
                                return;
                            }

                            largestSizeInMib =
                                JSON.parse(sizes[sizes.length - 1]).size;

                            ctx.unavailableVolumeSize =
                                (largestSizeInMib / MIBS_IN_GIB + 1) + 'G';

                            next();
                        });
                },
                function createVolWithUnavailableSize(ctx, next) {
                    h.triton([
                        'volume',
                        'create',
                        '--name',
                        validVolumeName,
                        '--size',
                        ctx.unavailableVolumeSize,
                        '-w'
                    ].join(' '), function (volCreateErr, stdout, stderr) {
                        var actualErrMsg;
                        var expectedErrMsg = 'volume size not available';

                        t.ok(volCreateErr,
                                'volume creation with unavailable size ' +
                                    ctx.unavailableVolumeSize +
                                    ' should error');

                        if (volCreateErr) {
                            actualErrMsg = stderr;
                            t.notEqual(actualErrMsg.indexOf(expectedErrMsg), -1,
                                'error message should include: ' +
                                    expectedErrMsg + ' and got: ' +
                                    actualErrMsg);
                        }

                        next();
                    });
                }
            ]}, function onTestDone(err) {
                t.end();
            });
        });

    suite.end();
});
