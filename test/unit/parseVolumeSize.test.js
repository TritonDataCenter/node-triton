/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Unit tests for `parseVolumeSize` used by `triton volume ...`.
 */

var assert = require('assert-plus');
var test = require('tape');

var parseVolumeSize = require('../../lib/volumes').parseVolumeSize;

test('parseVolumeSize', function (tt) {
    tt.test('parsing invalid sizes', function (t) {
        var invalidVolumeSizes = [
            'foo',
            '0',
            '-42',
            '-42m',
            '-42g',
            '',
            '42Gasdf',
            '42gasdf',
            '42asdf',
            'asdf42G',
            'asdf42g',
            'asdf42',
            '042g',
            '042G',
            '042',
            0,
            42,
            -42,
            42.1,
            -42.1,
            undefined,
            null,
            {}
        ];

        invalidVolumeSizes.forEach(function parse(invalidVolumeSize) {
            var parseErr;

            try {
                parseVolumeSize(invalidVolumeSize);
            } catch (err) {
                parseErr = err;
            }

            t.ok(parseErr, 'parsing invalid volume size: ' + invalidVolumeSize +
                ' should throw');
        });

        t.end();
    });

    tt.test('parsing valid sizes', function (t) {
        var validVolumeSizes = [
            {input: '42g', expectedOutput: 42 * 1024},
            {input: '42G', expectedOutput: 42 * 1024},
            {input: '42m', expectedOutput: 42},
            {input: '42M', expectedOutput: 42}
        ];

        validVolumeSizes.forEach(function parse(validVolumeSize) {
            var parseErr;
            var volSizeInMebibytes;

            try {
                volSizeInMebibytes = parseVolumeSize(validVolumeSize.input);
            } catch (err) {
                parseErr = err;
            }

            t.ifErr(parseErr, 'parsing valid volume size: ' +
                validVolumeSize.input + ' should not throw');
            t.equal(validVolumeSize.expectedOutput, volSizeInMebibytes,
                'parsed volume size for "' + validVolumeSize.input + '" ' +
                    'should equal to ' + validVolumeSize.expectedOutput +
                        ' mebibytes');
        });

        t.end();
    });
});