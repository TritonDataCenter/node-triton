/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * Utilities for parsing disks from CLI options.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');

var common = require('./common');
var errors = require('./errors');

/*
 * Load and validate disks from these options:
 *      --disk DATA --disk DATA --disk DATA
 *      --disk @FILE
 */
function disksFromArgs(disks, log, cb) {
    assert.array(disks, 'disks');
    assert.object(log, 'log');
    assert.func(cb, 'cb');
    if (disks.length === 1 && disks[0].indexOf('@') === 0) {
        _addDisksFromFile(disks[0].slice(1), cb);
    } else {
        disks = disks.map(function parseDisk(disk) {
            return JSON.parse(disk);
        });
        _validateDisksSize(disks, cb);
    }
}

function _validateDisksSize(disks, cb) {
    var errs = [];
    var err;
    disks.forEach(function validateSize(disk) {
        if (disk.size && disk.size !== 'remaining') {
            var size = Number(disk.size);
            if (isNaN(size) || size < 0) {
                errs.push(new errors.UsageError(format(
                    'SIZE must be a positive number or "remaining": \'%j\'',
                        disk)));
            } else {
                disk.size = size;
            }
        }
    });

    if (errs.length > 1) {
        err = new errors.MultiError(errs);
    } else {
        err = errs[0];
    }
    cb(err, disks);
}

function _addDisksFromJsonStr(disksStr, cb) {
    assert.string(disksStr, 'disksStr');
    try {
        var disks = JSON.parse(disksStr);
    } catch (parseErr) {
        cb(new errors.TritonError(parseErr,
            format('%s is not valid JSON', disksStr)));
        return;
    }
    _validateDisksSize(disks, cb);
}

function _addDisksFromFile(fileStr, cb) {
    assert.string(fileStr, 'fileStr');

    var filePath = common.tildeSync(fileStr);
    fs.stat(filePath, function onStat(statErr, stats) {
        if (statErr || !stats.isFile()) {
            cb(new errors.TritonError(format(
                'disks path "%s" is not an existing file', fileStr)));
            return;
        }

        fs.readFile(filePath, 'utf8', function onRead(readErr, data) {
            if (readErr) {
                cb(readErr);
                return;
            }

            _addDisksFromJsonStr(data, cb);
        });
    });
}

module.exports = {
    disksFromArgs: disksFromArgs
};
