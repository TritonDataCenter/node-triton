/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * Utilities for parsing metadata and tags from CLI options.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var tilde = require('tilde-expansion');
var vasync = require('vasync');

var errors = require('./errors');


/*
 * Load and validate metadata from these options:
 *      -m,--metadata DATA
 *      -M,--metadata-file KEY=FILE
 *      --script FILE
 *
 * <https://github.com/joyent/sdc-vmapi/blob/master/docs/index.md#vm-metadata>
 * says values may be string, num or bool.
 */
function metadataFromOpts(opts, log, cb) {
    assert.arrayOfObject(opts._order, 'opts._order');
    assert.object(log, 'log');
    assert.func(cb, 'cb');

    var metadata = {};

    vasync.forEachPipeline({
        inputs: opts._order,
        func: function metadataFromOpt(o, next) {
            log.trace({opt: o}, 'metadataFromOpt');
            if (o.key === 'metadata') {
                if (!o.value) {
                    next(new errors.UsageError(
                        'empty metadata option value'));
                    return;
                } else if (o.value[0] === '{') {
                    _addMetadataFromJsonStr(
                        'metadata', metadata, o.value, null, next);
                } else if (o.value[0] === '@') {
                    _addMetadataFromFile(
                        'metadata', metadata, o.value.slice(1), next);
                } else {
                    _addMetadataFromKvStr(
                        'metadata', metadata, o.value, null, next);
                }
            } else if (o.key === 'metadata_file') {
                _addMetadataFromKfStr(
                    'metadata', metadata, o.value, null, next);
            } else if (o.key === 'script') {
                _addMetadatumFromFile('metadata', metadata,
                    'user-script', o.value, o.value, next);
            } else {
                next();
            }
        }
    }, function (err) {
        if (err) {
            cb(err);
        } else if (Object.keys(metadata).length) {
            cb(null, metadata);
        } else {
            cb();
        }
    });
}


/*
 * Load and validate tags from these options:
 *      -t,--tag DATA
 *
 * <https://github.com/joyent/sdc-vmapi/blob/master/docs/index.md#vm-metadata>
 * says values may be string, num or bool.
 */
function tagsFromOpts(opts, log, cb) {
    assert.arrayOfObject(opts._order, 'opts._order');
    assert.object(log, 'log');
    assert.func(cb, 'cb');

    var tags = {};

    vasync.forEachPipeline({
        inputs: opts._order,
        func: function tagsFromOpt(o, next) {
            log.trace({opt: o}, 'tagsFromOpt');
            if (o.key === 'tag') {
                if (!o.value) {
                    next(new errors.UsageError(
                        'empty tag option value'));
                    return;
                } else if (o.value[0] === '{') {
                    _addMetadataFromJsonStr('tag', tags, o.value, null, next);
                } else if (o.value[0] === '@') {
                    _addMetadataFromFile('tag', tags, o.value.slice(1), next);
                } else {
                    _addMetadataFromKvStr('tag', tags, o.value, null, next);
                }
            } else {
                next();
            }
        }
    }, function (err) {
        if (err) {
            cb(err);
        } else if (Object.keys(tags).length) {
            cb(null, tags);
        } else {
            cb();
        }
    });
}


var allowedTypes = ['string', 'number', 'boolean'];
function _addMetadatum(ilk, metadata, key, value, from, cb) {
    assert.string(ilk, 'ilk');
    assert.object(metadata, 'metadata');
    assert.string(key, 'key');
    assert.optionalString(from, 'from');
    assert.func(cb, 'cb');

    if (allowedTypes.indexOf(typeof (value)) === -1) {
        cb(new errors.UsageError(format(
            'invalid %s value type%s: must be one of %s: %s=%j',
            ilk, (from ? ' (from ' + from + ')' : ''),
            allowedTypes.join(', '), key, value)));
        return;
    }

    if (metadata.hasOwnProperty(key)) {
        var valueStr = value.toString();
        console.error(
            'warning: %s "%s=%s"%s replaces earlier value for "%s"',
            ilk,
            key,
            (valueStr.length > 10
                ? valueStr.slice(0, 7) + '...' : valueStr),
            (from ? ' (from ' + from + ')' : ''),
            key);
    }
    metadata[key] = value;
    cb();
}

function _addMetadataFromObj(ilk, metadata, obj, from, cb) {
    assert.string(ilk, 'ilk');
    assert.object(metadata, 'metadata');
    assert.object(obj, 'obj');
    assert.optionalString(from, 'from');
    assert.func(cb, 'cb');

    vasync.forEachPipeline({
        inputs: Object.keys(obj),
        func: function _oneField(key, next) {
            _addMetadatum(ilk, metadata, key, obj[key], from, next);
        }
    }, cb);
}

function _addMetadataFromJsonStr(ilk, metadata, s, from, cb) {
    assert.string(ilk, 'ilk');
    try {
        var obj = JSON.parse(s);
    } catch (parseErr) {
        cb(new errors.TritonError(parseErr,
            format('%s%s is not valid JSON', ilk,
                (from ? ' (from ' + from + ')' : ''))));
        return;
    }
    _addMetadataFromObj(ilk, metadata, obj, from, cb);
}

function _addMetadataFromFile(ilk, metadata, file, cb) {
    assert.string(ilk, 'ilk');
    tilde(file, function (metaPath) {
        fs.stat(metaPath, function (statErr, stats) {
            if (statErr || !stats.isFile()) {
                cb(new errors.TritonError(format(
                    '"%s" is not an existing file', file)));
                return;
            }
            fs.readFile(metaPath, 'utf8', function (readErr, data) {
                if (readErr) {
                    cb(readErr);
                    return;
                }
                /*
                 * The file is either a JSON object (first non-space
                 * char is '{'), or newline-separated key=value
                 * pairs.
                 */
                var dataTrim = data.trim();
                if (dataTrim.length && dataTrim[0] === '{') {
                    _addMetadataFromJsonStr(ilk, metadata, dataTrim, file, cb);
                } else {
                    var lines = dataTrim.split(/\r?\n/g).filter(
                        function (line) { return line.trim(); });
                    vasync.forEachPipeline({
                        inputs: lines,
                        func: function oneLine(line, next) {
                            _addMetadataFromKvStr(
                                ilk, metadata, line, file, next);
                        }
                    }, cb);
                }
            });
        });
    });
}

function _addMetadataFromKvStr(ilk, metadata, s, from, cb) {
    assert.string(ilk, 'ilk');

    var parts = strsplit(s, '=', 2);
    if (parts.length !== 2) {
        cb(new errors.UsageError(format(
            'invalid KEY=VALUE %s argument: %s', ilk, s)));
        return;
    }
    var value = parts[1];
    var valueTrim = value.trim();
    if (valueTrim === 'true') {
        value = true;
    } else if (valueTrim === 'false') {
        value = false;
    } else {
        var num = Number(value);
        if (!isNaN(num)) {
            value = num;
        }
    }
    _addMetadatum(ilk, metadata, parts[0].trim(), value, from, cb);
}

/*
 * Add metadata from `KEY=FILE` argument.
 * Here "Kf" stands for "key/file".
 */
function _addMetadataFromKfStr(ilk, metadata, s, from, cb) {
    assert.string(ilk, 'ilk');

    var parts = strsplit(s, '=', 2);
    if (parts.length !== 2) {
        cb(new errors.UsageError(format(
            'invalid KEY=FILE %s argument: %s', ilk, s)));
        return;
    }
    var key = parts[0].trim();
    var file = parts[1];

    _addMetadatumFromFile(ilk, metadata, key, file, file, cb);
}

function _addMetadatumFromFile(ilk, metadata, key, file, from, cb) {
    assert.string(ilk, 'ilk');

    tilde(file, function (filePath) {
        fs.stat(filePath, function (statErr, stats) {
            if (statErr || !stats.isFile()) {
                cb(new errors.TritonError(format(
                    '%s path "%s" is not an existing file', ilk, file)));
                return;
            }
            fs.readFile(filePath, 'utf8', function (readErr, content) {
                if (readErr) {
                    cb(readErr);
                    return;
                }
                _addMetadatum(ilk, metadata, key, content, from, cb);
            });
        });
    });
}


module.exports = {
    metadataFromOpts: metadataFromOpts,
    tagsFromOpts: tagsFromOpts
};
