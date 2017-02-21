/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Test volume create command's size parameter.
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
test('triton volume create with non-default size...', testOpts, function (tt) {
    var validVolumeName =
            h.makeResourceName('node-triton-test-volume-create-non-default-' +
                'size');
    var validVolumeSize = '20g';
    var validVolumeSizeInMib = 20 * 1024;

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

    tt.test('  triton volume create volume with non-default size',
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

    tt.test('  check volume was created', function (t) {
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

    tt.test('  delete volume', function (t) {
        h.safeTriton(t, ['volume', 'delete', '-y', '-w', validVolumeName],
            function onDelVolume(delVolErr, stdout) {
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
});