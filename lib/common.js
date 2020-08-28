/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var assert = require('assert-plus');
var child_process = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var getpass = require('getpass');
var os = require('os');
var path = require('path');
var read = require('read');
var strsplit = require('strsplit');
var tty = require('tty');
var util = require('util'),
    format = util.format;
var wordwrap = require('wordwrap');

var errors = require('./errors'),
    InternalError = errors.InternalError;
var NETWORK_OBJECT_FIELDS =
    require('./constants').NETWORK_OBJECT_FIELDS;


// ---- support stuff

function objCopy(obj, target) {
    assert.object(obj, 'obj');
    assert.optionalObject(obj, 'target');

    if (target === undefined) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}


function deepObjCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}


/*
 * Merge given objects into the given `target` object. Last one wins.
 * The `target` is modified in place.
 *
 *      var foo = {bar: 32};
 *      objMerge(foo, {bar: 42}, {bling: 'blam'});
 *
 * Adapted from tunnel-agent `mergeOptions`.
 */
function objMerge(target) {
    for (var i = 1, len = arguments.length; i < len; ++i) {
        var overrides = arguments[i];
        if (typeof (overrides) === 'object') {
            var keys = Object.keys(overrides);
            for (var j = 0, keyLen = keys.length; j < keyLen; ++j) {
                var k = keys[j];
                if (overrides[k] !== undefined) {
                    target[k] = overrides[k];
                }
            }
        }
    }
    return target;
}


function zeroPad(n, width) {
    var s = String(n);
    assert.number(width, 'width');
    assert.string(s, 'string');

    while (s.length < width) {
        s = '0' + s;
    }
    return s;
}


/**
 * Convert a boolean or string representation into a boolean, or
 * raise TypeError trying.
 *
 * @param value {Boolean|String} The input value to convert.
 * @param default_ {Boolean} The default value if `value` is undefined.
 * @param errName {String} The context to quote in the possibly
 *      raised TypeError.
 */
function boolFromString(value, default_, errName) {
    if (value === undefined) {
        return default_;
    } else if (value === 'false' || value === '0') {
        return false;
    } else if (value === 'true' || value === '1') {
        return true;
    } else if (typeof (value) === 'boolean') {
        return value;
    } else {
        var errmsg = format('invalid boolean value: %j', value);
        if (errName) {
            errmsg = format('invalid boolean value for %s: %j', errName, value);
        }
        throw new TypeError(errmsg);
    }
}

/**
 * given an array return a string with each element
 * JSON-stringifed separated by newlines
 */
function jsonStream(arr, stream) {
    stream = stream || process.stdout;

    arr.forEach(function (elem) {
        stream.write(JSON.stringify(elem) + '\n');
    });
}

/**
 * Parses the string "kv" of the form 'key=value' and returns an object that
 * represents it with the form {'key': value}. If "key"" in the "kv" string is
 * not included in the list "validKeys", it throws an error. It also throws an
 * error if the string "kv" is malformed.
 *
 * By default, converts the values as if they were JSON representations of JS
 * types, e.g the string 'false' is converted to the boolean primitive "false".
 *
 * @param {String} kv
 * @param {Array} validKeys: Optional array of strings or regexes matching
 *      valid keys.
 * @param {Object} options: Optional
 *      - @param disableTypeConversions {Boolean} Optional. If true, then no
 *        type conversion of values is performed, and all values are returned as
 *        strings.
 *      - @param typeHintFromKey {Object} Optional. Type hints for input keys.
 *        E.g. if parsing 'foo=false' and `typeHintFromKey={foo: 'string'}`,
 *        then we do NOT parse it to a boolean `false`.
 *      - @param failOnEmptyValue {Boolean} Optional - If true, throws an error
 *        if a given key's value is the empty string. Default is false.
 */
function _parseKeyValue(kv, validKeys, options) {
    assert.string(kv, 'kv');
    assert.optionalArray(validKeys, 'validKeys');
    assert.optionalObject(options, 'options');
    options = options || {};
    assert.optionalBool(options.disableTypeConversions,
        'options.disableTypeConversions');
    assert.optionalObject(options.typeHintFromKey, 'options.typeHintFromKey');
    assert.optionalBool(options.failOnEmptyValue, 'options.failOnEmptyValue');

    var i;
    var idx = kv.indexOf('=');
    if (idx === -1) {
        throw new errors.UsageError(format('invalid key=value: "%s"', kv));
    }
    var k = kv.slice(0, idx);
    var typeHint;
    var v = kv.slice(idx + 1);
    var validKey;

    if (validKeys) {
        var foundMatch = false;
        for (i = 0; i < validKeys.length; i++) {
            validKey = validKeys[i];
            if ((validKey instanceof RegExp && validKey.test(k)) ||
                k === validKey) {
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            throw new errors.UsageError(format(
                'invalid key: "%s" (must match one of: %s)',
                k, validKeys.join(', ')));
        }
    }

    if (v === '' && options.failOnEmptyValue) {
        throw new Error(format('key "%s" must have a value', k));
    }

    if (options.disableTypeConversions !== true) {
        if (options.typeHintFromKey !== undefined) {
            typeHint = options.typeHintFromKey[k];
        }

        if (typeHint === 'string') {
            // Leave `v` a string.
            /* jsl:pass */
        } else if (v === '') {
            v = null;
        } else {
            try {
                v = JSON.parse(v);
            } catch (e) {
                /* pass */
            }
        }
    }

    return {
        key: k,
        value: v
    };
}


/**
 * given an array of key=value pairs, break them into a JSON predicate
 *
 * @param {Array} kvs - an array of key=value pairs
 * @param {Array} validKeys: Optional array of strings or regexes matching
 *      valid keys.
 * @param {String} compositionType - the way each key/value pair will be
 *  combined to form a JSON predicate. Valid values are 'or' and 'and'.
 */
function jsonPredFromKv(kvs, validKeys, compositionType) {
    assert.arrayOfString(kvs, 'kvs');
    assert.string(compositionType, 'string');
    assert.ok(compositionType === 'or' || compositionType === 'and',
        'compositionType');

    var keyName;
    var predicate = {};
    var parsedKeyValue;
    var parsedKeyValues;
    var parseOpts = {
        disableDotted: true,
        validKeys: validKeys,
        failOnEmptyValue: true
    };

    if (kvs.length === 0) {
        return predicate;
    }

    if (kvs.length === 1) {
        parsedKeyValue = _parseKeyValue(kvs[0], validKeys, parseOpts);
        predicate.eq = [parsedKeyValue.key, parsedKeyValue.value];
    } else {
        predicate[compositionType] = [];
        parsedKeyValues = objFromKeyValueArgs(kvs, parseOpts);

        for (keyName in parsedKeyValues) {
            predicate[compositionType].push({
                eq: [keyName, parsedKeyValues[keyName]]
            });
        }
    }

    return predicate;
}

/**
 * return how long ago something happened
 *
 * @param {Date} when - a date object in the past
 * @param {Date} now (optional) - a date object to compare to
 * @return {String} - printable string
 */
function longAgo(when, now) {
    now = now || new Date();
    assert.date(now, 'now');

    var seconds = Math.round((now - when) / 1000);
    var times = [
        seconds / 60 / 60 / 24 / 365, // years
        seconds / 60 / 60 / 24 / 7,   // weeks
        seconds / 60 / 60 / 24,       // days
        seconds / 60 / 60,            // hours
        seconds / 60,                 // minutes
        seconds                       // seconds
    ];
    var names = ['y', 'w', 'd', 'h', 'm', 's'];

    for (var i = 0; i < names.length; i++) {
        var time = Math.floor(times[i]);
        if (time > 0)
            return util.format('%d%s', time, names[i]);
    }
    return '0s';
}

/**
 * checks a string and returns a boolean based on if it
 * is a UUID or not
 */
function isUUID(s) {
    assert.string(s, 's');
    return /^([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)$/i.test(s);
}


function humanDurationFromMs(ms) {
    assert.number(ms, 'ms');
    var sizes = [
        ['ms', 1000, 's'],
        ['s', 60, 'm'],
        ['m', 60, 'h'],
        ['h', 24, 'd'],
        ['d', 7, 'w']
    ];
    if (ms === 0) {
        return '0ms';
    }
    var bits = [];
    var n = ms;
    for (var i = 0; i < sizes.length; i++) {
        var size = sizes[i];
        var remainder = n % size[1];
        if (remainder === 0) {
            bits.unshift('');
        } else {
            bits.unshift(format('%d%s', remainder, size[0]));
        }
        n = Math.floor(n / size[1]);
        if (n === 0) {
            break;
        } else if (i === sizes.length - 1) {
            bits.unshift(format('%d%s', n, size[2]));
            break;
        }
    }
    if (bits.length > 1 && bits[bits.length - 1].slice(-2) === 'ms') {
        bits.pop();
    }
    return bits.slice(0, 2).join('');
}

/**
 * Adapted from <http://stackoverflow.com/a/18650828>
 *
 * @param {Number} opts.precision The number of decimal places of precision to
 *      include. Note: This is just clipping (i.e. floor) instead of rounding.
 *      TODO: round
 * @param {Boolean} opts.narrow Make it as narrow as possible: short units,
 *      no space between value and unit, drop precision if it is all zeros.
 */
function humanSizeFromBytes(opts, bytes) {
    if (bytes === undefined) {
        bytes = opts;
        opts = {};
    }
    assert.number(bytes, 'bytes');
    // The number of decimal places, default 1.
    assert.optionalNumber(opts.precision, 'opts.precision');
    var precision = opts.precision === undefined ? 1 : opts.precision;
    assert.ok(precision >= 0);
    assert.optionalBool(opts.narrow, 'opts.narrow');

    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    if (opts.narrow) {
        sizes = ['B', 'K', 'M', 'G', 'T', 'P'];
    }
    var template = opts.narrow ? '%s%s%s' : '%s%s %s';

    if (bytes === 0) {
        return '0 B';
    }

    var sign = bytes < 0 ? '-' : '';
    bytes = Math.abs(bytes);

    var i = Number(Math.floor(Math.log(bytes) / Math.log(1024)));
    var s = String(bytes / Math.pow(1024, i));
    var hasDecimal = s.indexOf('.') !== -1;
    if (precision === 0) {
        if (hasDecimal) {
            s = s.slice(0, s.indexOf('.'));
        }
    } else if (opts.narrow && !hasDecimal) {
        /* skip all-zero precision */
        /* jsl:pass */
    } else {
        if (!hasDecimal) {
            s += '.';
        }
        var places = s.length - s.indexOf('.') - 1;
        while (places < precision) {
            s += '0';
            places++;
        }
        if (places > precision) {
            s = s.slice(0, s.length - places + precision);
        }
    }
    //var precision1 = (s.indexOf('.') === -1
    //    ? s + '.0' : s.slice(0, s.indexOf('.') + 2));

    return format(template, sign, s, sizes[i]);
}

/*
 * capitalize the first character of a string and return the new string
 */
function capitalize(s) {
    assert.string(s, 's');
    return s[0].toUpperCase() + s.substr(1);
}

/*
 * Convert a UUID to a short ID
 */
function uuidToShortId(s) {
    assert.uuid(s, 's');
    return s.split('-', 1)[0];
}

/*
 * Normalize a short ID. Returns undefined if the given string isn't a valid
 * short id.
 *
 * Short IDs:
 * - UUID prefix
 * - allow '-' to be elided (to support using containers IDs from docker)
 * - support docker ID *longer* than a UUID? The curr implementation does.
 */
function normShortId(s) {
    assert.string(s, 's');

    var shortIdCharsRe = /^[a-f0-9]+$/;
    var shortId;
    if (s.indexOf('-') === -1) {
        if (!shortIdCharsRe.test(s)) {
            return;
        }
        shortId = s.substr(0, 8) + '-'
            + s.substr(8, 4) + '-'
            + s.substr(12, 4) + '-'
            + s.substr(16, 4) + '-'
            + s.substr(20, 12);
        shortId = shortId.replace(/-+$/, '');
    } else {
        // UUID prefix.
        shortId = '';
        var remaining = s;
        var spans = [8, 4, 4, 4, 12];
        for (var i = 0; i < spans.length; i++) {
            var span = spans[i];
            var head = remaining.slice(0, span);
            remaining = remaining.slice(span + 1);
            if (!shortIdCharsRe.test(head)) {
                return;
            }
            shortId += head;
            if (remaining && i + 1 < spans.length) {
                shortId += '-';
            } else {
                break;
            }
        }
    }
    return shortId;
}

/*
 * Take a "profile" object and return a slug based on: account, url and user.
 * This is currently used to create a filesystem-safe name to use for caching
 */
function profileSlug(o) {
    assert.object(o, 'o');
    assert.string(o.account, 'o.account');
    assert.string(o.url, 'o.url');

    var slug;
    var account = o.account;
    if (o.actAsAccount)
        account = o.actAsAccount;
    account = account.replace(/[@]/g, '_');
    var url = o.url.replace(/^https?:\/\//, '');
    if (o.user) {
        var user = o.user.replace(/[@]/g, '_');
        slug = format('%s-%s@%s', user, account, url);
    } else {
        slug = format('%s@%s', account, url);
    }
    slug = slug.replace(/[!#$%\^&\*:'"\?\/\\\.]/g, '_');
    return slug;
}


/*
 * Return a filename-safe slug for the given string.
 */
function filenameSlug(str) {
    return str
        .toLowerCase()
        .replace(/ +/g, '-')
        .replace(/[^-\w]/g, '');
}

/*
 * take some basic information and return node-cmdln options suitable for
 * tabula
 *
 * @param {String} (optional) opts.columnDefault Default value for `-o`
 * @param {String} (optional) opts.sortDefault Default value for `-s`
 * @param {String} (optional) opts.includeLong Include `-l` option
 * @return {Array} Array of cmdln options objects
 */
function getCliTableOptions(opts) {
    opts = opts || {};
    assert.object(opts, 'opts');
    assert.optionalString(opts.columnsDefault, 'opts.columnsDefault');
    assert.optionalString(opts.sortDefault, 'opts.sortDefault');
    assert.optionalBool(opts.includeLong, 'opts.includeLong');

    var o;

    // construct the options object
    var tOpts = [];

    // header
    tOpts.push({
        group: 'Output options'
    });

    // -H
    tOpts.push({
        names: ['H'],
        type: 'bool',
        help: 'Omit table header row.'
    });

    // -o field1,field2,...
    o = {
        names: ['o'],
        type: 'string',
        help: 'Specify fields (columns) to output.',
        helpArg: 'field1,...'
    };
    if (opts.columnsDefault)
        o.default = opts.columnsDefault;
    tOpts.push(o);

    // -l, --long
    if (opts.includeLong) {
        tOpts.push({
            names: ['long', 'l'],
            type: 'bool',
            help: 'Long/wider output. Ignored if "-o ..." is used.'
        });
    }

    // -s field1,field2,...
    o = {
        names: ['s'],
        type: 'string',
        help: 'Sort on the given fields.',
        helpArg: 'field1,...'
    };
    if (opts.sortDefault) {
        o.default = opts.sortDefault;
        o.help = format('%s Default is "%s".', o.help, opts.sortDefault);
    }
    tOpts.push(o);

    // -j, --json
    tOpts.push({
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    });

    return tOpts;
}


/**
 * Prompt a user for a y/n answer.
 *
 *      cb('y')        user entered in the affirmative
 *      cb('n')        user entered in the negative
 *      cb(false)      user ^C'd
 *
 * Dev Note: Borrowed from imgadm's common.js. If this starts showing issues,
 * we should consider using the npm 'read' module.
 */
function promptYesNo(opts_, cb) {
    assert.object(opts_, 'opts');
    assert.string(opts_.msg, 'opts.msg');
    assert.optionalString(opts_.default, 'opts.default');
    var opts = objCopy(opts_);

    // Setup stdout and stdin to talk to the controlling terminal if
    // process.stdout or process.stdin is not a TTY.
    var stdout;
    if (opts.stdout) {
        stdout = opts.stdout;
    } else if (process.stdout.isTTY) {
        stdout = process.stdout;
    } else {
        opts.stdout_fd = fs.openSync('/dev/tty', 'r+');
        stdout = opts.stdout = new tty.WriteStream(opts.stdout_fd);
    }
    var stdin;
    if (opts.stdin) {
        stdin = opts.stdin;
    } else if (process.stdin.isTTY) {
        stdin = process.stdin;
    } else {
        opts.stdin_fd = fs.openSync('/dev/tty', 'r+');
        stdin = opts.stdin = new tty.ReadStream(opts.stdin_fd);
    }

    stdout.write(opts.msg);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    var input = '';
    stdin.on('data', onData);

    function postInput() {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
    }

    function finish(rv) {
        if (opts.stdout_fd !== undefined) {
            stdout.end();
            delete opts.stdout_fd;
        }
        if (opts.stdin_fd !== undefined) {
            stdin.end();
            delete opts.stdin_fd;
        }
        cb(rv);
    }

    function onData(ch) {
        ch = ch + '';

        switch (ch) {
        case '\n':
        case '\r':
        case '\u0004':
            // EOT. They've finished typing their answer
            postInput();
            var answer = input.toLowerCase();
            if (answer === '' && opts.default) {
                finish(opts.default);
            } else if (answer === 'yes' || answer === 'y') {
                finish('y');
            } else if (answer === 'no' || answer === 'n') {
                finish('n');
            } else {
                stdout.write('Please enter "y", "yes", "n" or "no".\n');
                promptYesNo(opts, cb);
                return;
            }
            break;
        case '\u0003': // Ctrl C
            postInput();
            finish(false);
            break;
        case '\u007f': // DEL
            input = input.slice(0, -1);
            stdout.clearLine();
            stdout.cursorTo(0);
            stdout.write(opts.msg);
            stdout.write(input);
            break;
        default:
            // Rule out special ASCII chars.
            var code = ch.charCodeAt(0);
            if (0 <= code && code <= 31) {
               break;
            }
            // More plaintext characters
            stdout.write(ch);
            input += ch;
            break;
        }
    }
}


/*
 * Prompt and wait for <Enter> or Ctrl+C. Usage:
 *
 *      common.promptEnter('Press <Enter> to re-edit, Ctrl+C to abort.',
 *          function (err) {
 *              if (err) {
 *                  // User hit Ctrl+C
 *              } else {
 *                  // User hit Enter
 *              }
 *          }
 *      );
 */
function promptEnter(prompt, cb) {
    read({
        prompt: prompt
    }, function (err, result, isDefault) {
        cb(err);
    });
}


/*
 * Prompt the user for a value.
 *
 * @params field {Object}
 *      - field.desc {String} Optional. A description of the field to print
 *        before prompting.
 *      - field.key {String} The field name. Used as the prompt.
 *      - field.default  Optional default value.
 *      - field.validate {Function} Optional. A validation/manipulation
 *        function of the form:
 *              function (value, cb)
 *        which should callback with
 *              cb([<error or null>, [<manipulated value>]])
 *        examples:
 *              cb(new Error('value is not a number'));
 *              cb();   // value is fine as is
 *              cb(null, Math.floor(Number(value))); // manip to a floored int
 *      - field.required {Boolean} Optional. If `field.validate` is not
 *        given, `required=true` will provide a validate func that requires
 *        a value.
 * @params cb {Function} `function (err, value)`
 *      If the user aborted, the `err` will be whatever the [read
 *      package](https://www.npmjs.com/package/read) returns, i.e. a
 *      string "cancelled".
 */
function promptField(field, cb) {
    var wrap = wordwrap(Math.min(process.stdout.columns, 80));

    var validate = field.validate;
    if (!validate && field.required) {
        validate = function (value, validateCb) {
            if (!value) {
                validateCb(new Error(format('A value for "%s" is required.',
                    field.key)));
            } else {
                validateCb();
            }
        };
    }

    function attempt(next) {
        read({
            // read/readline prompting messes up width with ANSI codes here.
            prompt: field.key + ':',
            default: field.default,
            silent: field.password,
            edit: true
        }, function (err, result, isDefault) {
            if (err) {
                return cb(err);
            }
            var value = result.trim();
            if (!validate) {
                return cb(null, value);
            }

            validate(value, function (validationErr, newValue) {
                if (validationErr) {
                    console.log(ansiStylize(
                        wrap(validationErr.message), 'red'));
                    attempt();
                } else {
                    if (newValue !== undefined) {
                        value = newValue;
                    }
                    cb(null, value);
                }
            });
        });
    }

    if (field.desc) {
        // Wrap, if no newlines.
        var wrapped = field.desc;
        if (field.desc.indexOf('\n') === -1) {
            wrapped = wrap(field.desc);
        }

        // Bold up to the first period, or all of it, if no period.
        var periodIdx = wrapped.indexOf('.');
        if (periodIdx !== -1) {
            console.log(
                ansiStylize(wrapped.slice(0, periodIdx + 1), 'bold') +
                wrapped.slice(periodIdx + 1));
        } else {
            console.log(ansiStylize(wrap(field.desc), 'bold'));
        }
    }
    attempt();
}


/**
 * A utility method to unlock a private key on a TritonApi client instance,
 * if necessary.
 *
 * If the client's key is locked, this will prompt for the passphrase on the
 * TTY (via the `getpass` module) and attempt to unlock.
 *
 * @param opts {Object}
 *      - opts.tritonapi {Object} An `.init()`ialized TritonApi instance.
 * @param cb {Function} `function (err)`
 */
function promptPassphraseUnlockKey(opts, cb) {
    assert.object(opts.tritonapi, 'opts.tritonapi');

    var kp = opts.tritonapi.keyPair;
    if (!kp) {
        cb(new errors.InternalError('TritonApi instance given to '
            + 'promptPassphraseUnlockKey is not initialized'));
        return;
    }

    if (!kp.isLocked()) {
        cb();
        return;
    }

    var keyDesc;
    if (kp.source !== undefined) {
        keyDesc = kp.source;
    } else if (kp.comment !== undefined && kp.comment.length > 1) {
        keyDesc = kp.getPublicKey().type.toUpperCase() +
            ' key for ' + kp.comment;
    } else {
        keyDesc = kp.getPublicKey().type.toUpperCase() +
            ' key ' + kp.getKeyId();
    }
    var getpassOpts = {
        prompt: 'Enter passphrase for ' + keyDesc
    };

    var tryPass = function (err, pass) {
        if (err) {
            cb(err);
            return;
        }

        try {
            kp.unlock(pass);
        } catch (unlockErr) {
            getpassOpts.prompt = 'Bad passphrase, try again for ' + keyDesc;
            getpass.getPass(getpassOpts, tryPass);
            return;
        }

        cb(null);
    };

    getpass.getPass(getpassOpts, tryPass);
}


/*
 * A utility for the `triton` CLI subcommands to `init()`ialize a
 * `tritonapi` instance and ensure that the profile's key is unlocked
 * (prompting on a TTY if necessary).  This is typically the CLI's
 * `tritonapi` instance, but a `tritonapi` can also be passed in
 * directly.
 *
 * @param opts.cli {Object}
 * @param opts.tritonapi {Object}
 * @param cb {Function} `function (err)`
 */
function cliSetupTritonApi(opts, cb) {
    assert.optionalObject(opts.cli, 'opts.cli');
    assert.optionalObject(opts.tritonapi, 'opts.tritonapi');
    var tritonapi = opts.tritonapi || opts.cli.tritonapi;
    assert.object(tritonapi, 'tritonapi');

    tritonapi.init(function (initErr) {
        if (initErr) {
            cb(initErr);
            return;
        }

        promptPassphraseUnlockKey({
            tritonapi: tritonapi
        }, function (keyErr) {
            cb(keyErr);
        });
    });
}


/**
 * Edit the given text in $EDITOR (defaulting to `vi`) and return the edited
 * text.
 *
 * This callback with `cb(err, updatedText, changed)` where `changed`
 * is a boolean true if the text was changed.
 */
function editInEditor(opts, cb) {
    assert.string(opts.text, 'opts.text');
    assert.optionalString(opts.filename, 'opts.filename');
    assert.optionalObject(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var tmpPath = path.resolve(os.tmpdir(),
        format('triton-%s-edit-%s', process.pid, opts.filename || 'text'));
    fs.writeFileSync(tmpPath, opts.text, 'utf8');

    var editor = process.env.EDITOR || '/usr/bin/vi';
    var argv = argvFromLine(format('%s "%s"', editor, tmpPath));
    if (opts.log) {
        opts.log.trace({argv: argv}, 'editInEditor argv');
    }

    var kid = child_process.spawn(argv[0], argv.slice(1), {stdio: 'inherit'});
    kid.on('exit', function (code, signal) {
        if (code || signal) {
            cb(new errors.TritonError(format(
                'editor terminated abnormally: argv=%j, code=%j, signal=%j',
                argv, code, signal)));
            return;
        }
        var afterText = fs.readFileSync(tmpPath, 'utf8');
        fs.unlinkSync(tmpPath);
        cb(null, afterText, (afterText !== opts.text));
    });
}


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
// Suggested colors (some are unreadable in common cases):
// - Good: cyan, yellow (limited use), bold, green, magenta, red
// - Bad: blue (not visible on cmd.exe), grey (same color as background on
//   Solarized Dark theme from <https://github.com/altercation/solarized>, see
//   issue #160)
var colors = {
    'bold' : [1, 22],
    'italic' : [3, 23],
    'underline' : [4, 24],
    'inverse' : [7, 27],
    'white' : [37, 39],
    'grey' : [90, 39],
    'black' : [30, 39],
    'blue' : [34, 39],
    'cyan' : [36, 39],
    'green' : [32, 39],
    'magenta' : [35, 39],
    'red' : [31, 39],
    'yellow' : [33, 39]
};

function ansiStylize(str, color) {
    if (!str)
        return '';
    var codes = colors[color];
    if (codes) {
        return '\033[' + codes[0] + 'm' + str +
                     '\033[' + codes[1] + 'm';
    } else {
        return str;
    }
}


/*
 * Style the given string with ANSI style codes *if stdout is a TTY*.
 */
function ansiStylizeTty(str, color) {
    if (!process.stdout.isTTY) {
        return str;
    } else {
        return ansiStylize(str, color);
    }
}


function indent(s, indentation) {
    if (!indentation) {
        indentation = '    ';
    }
    var lines = s.split(/\r?\n/g);
    return indentation + lines.join('\n' + indentation);
}


// http://perldoc.perl.org/functions/chomp.html
function chomp(s) {
    if (s.length) {
        while (s.slice(-1) === '\n') {
            s = s.slice(0, -1);
        }
    }
    return s;
}


/*
 * Generate a random password of the specified length (default 20 chars)
 * using ASCII printable, non-space chars: ASCII 33-126 (inclusive).
 *
 * No idea if this is crypto-sound. Doubt it.
 *
 * This needs to pass UFDS's "insufficientPasswordQuality". This actually
 * depends on the pwdcheckquality configurable JS function configured for
 * the datacenter. By default that is from:
 *     https://github.com/joyent/sdc-ufds/blob/master/data/bootstrap.ldif.in
 * which at the time of writing requires at least a number and a letter.
 */
function generatePassword(opts) {
    assert.optionalObject(opts, 'opts');
    opts = opts || {};
    assert.optionalNumber(opts.len, 'opts.len');

    var buf = crypto.randomBytes(opts.len || 20);
    var min = 33;
    var max = 126;
    var chars = [];
    for (var i = 0; i < buf.length; i++) {
        var num = Math.round(((buf[i] / 0xff) * (max - min)) + min);
        chars.push(String.fromCharCode(num));
    }
    var pwd = chars.join('');

    // "quality" checks
    if (!/[a-zA-Z]+/.test(pwd) || !/[0-9]+/.test(pwd)) {
        // Try again.
        return generatePassword(opts);
    } else {
        return pwd;
    }
}


/**
 * Convenience wrapper around `child_process.exec`, mostly oriented to
 * run commands using pipes w/o having to deal with logging/error handling.
 *
 * @param args {Object}
 *      - cmd {String} Required. The command to run.
 *      - log {Bunyan Logger} Required. Use to log details at trace level.
 *      - opts {Object} Optional. child_process.exec execution Options.
 * @param cb {Function} `function (err, stdout, stderr)` where `err` here is
 *      an `errors.InternalError` wrapper around the child_process error.
 */
function execPlus(args, cb) {
    assert.object(args, 'args');
    assert.string(args.cmd, 'args.cmd');
    assert.object(args.log, 'args.log');
    assert.optionalObject(args.opts, 'args.opts');
    assert.func(cb);

    var cmd = args.cmd;
    var execOpts = args.opts || {};
    var log = args.log;

    log.trace({exec: true, cmd: cmd}, 'exec start');
    child_process.exec(cmd, execOpts, function execPlusCb(err, stdout, stderr) {
        log.trace({exec: true, cmd: cmd, err: err, stdout: stdout,
            stderr: stderr}, 'exec done');
        if (err) {
            var msg = format(
                'exec error:\n'
                + '\tcmd: %s\n'
                + '\texit status: %s\n'
                + '\tstdout:\n%s\n'
                + '\tstderr:\n%s',
                cmd, err.code, stdout.trim(), stderr.trim());
            cb(new errors.InternalError(err, msg), stdout, stderr);
        } else {
            cb(null, stdout, stderr);
        }
    });
}


function deepEqual(a, b) {
    try {
        assert.deepEqual(a, b);
    } catch (err) {
        return false;
    }
    return true;
}


/**
 * Resolve "~/..." and "~" to an absolute path.
 *
 * Limitations:
 * - This does not handle "~user/...".
 * - This depends on the HOME envvar being defined (%USERPROFILE% on Windows).
 */
function tildeSync(s) {
    var envvar = (process.platform === 'win32' ? 'USERPROFILE' : 'HOME');
    var home = process.env[envvar];
    if (!home) {
        throw new Error(format('cannot determine home dir: %s environment ' +
            'variable is not defined', envvar));
    }

    if (s === '~') {
        return home;
    } else if (s.slice(0, 2) === '~/' ||
        (process.platform === 'win32' && s.slice(0, 2) === '~'+path.sep))
    {
        return path.resolve(home, s.slice(2));
    } else {
        return s;
    }
}


/**
 * Transform an array of 'key=value' CLI arguments to an object.
 *
 * - The use of '.' in the key allows sub-object assignment (only one level
 *   deep). This can be disabled with `opts.disableDotted`.
 * - An attempt will be made the `JSON.parse` a given value, such that
 *   booleans, numbers, objects, arrays can be specified; at the expense
 *   of not being able to specify, e.g., a literal 'true' string.
 *   If `opts.typeHintFromKey` states that a key is a string, this JSON.parse
 *   is NOT done.
 * - An empty 'value' is transformed to `null`. Note that 'null' also
 *   JSON.parse's as `null`.
 *
 * Example:
 *  > objFromKeyValueArgs(['nm=foo', 'tag.blah=true', 'empty=', 'nada=null']);
 *  { nm: 'foo',
 *    tag: { blah: true },
 *    empty: null,
 *    nada: null }
 *
 * @param args {Array} Array of string args to process.
 * @param opts {Object} Optional.
 *      - @param disableDotted {Boolean} Optional. Set to true to disable
 *        dotted keys.
 *      - @param typeHintFromKey {Object} Optional. Type hints for input keys.
 *        E.g. if parsing 'foo=false' and `typeHintFromKey={foo: 'string'}`,
 *        then we do NOT parse it to a boolean `false`.
 *      - @param {Array} validKeys: Optional array of strings or regexes
 *        matching valid keys. By default all keys are valid.
 *      - @param failOnEmptyValue {Boolean} Optional. If true, then a key with a
 *        value that is the empty string throws an error. Default is false.
 */
function objFromKeyValueArgs(args, opts)
{
    assert.arrayOfString(args, 'args');
    assert.optionalObject(opts, 'opts');
    opts = opts || {};
    assert.optionalBool(opts.disableDotted, 'opts.disableDotted');
    assert.optionalBool(opts.disableTypeConversions,
        'opts.disableTypeConversions');
    assert.optionalObject(opts.typeHintFromKey, opts.typeHintFromKey);
    assert.optionalBool(opts.failOnEmptyValue, 'opts.failOnEmptyValue');

    var obj = {};
    args.forEach(function (arg) {
        var parsedKeyValue = _parseKeyValue(arg, opts.validKeys, {
            typeHintFromKey: opts.typeHintFromKey,
            disableTypeConversions: opts.disableTypeConversions,
            failOnEmptyValue: opts.failOnEmptyValue
        });

        if (opts.disableDotted) {
            obj[parsedKeyValue.key] = parsedKeyValue.value;
        } else {
            var dotted = strsplit(parsedKeyValue.key, '.', 2);
            if (dotted.length > 1) {
                if (!obj[dotted[0]]) {
                    obj[dotted[0]] = {};
                }
                obj[dotted[0]][dotted[1]] = parsedKeyValue.value;
            } else {
                obj[parsedKeyValue.key] = parsedKeyValue.value;
            }
        }
    });

    return obj;
}

/**
 * Returns the time difference between the current time and the time
 * represented by "relativeTo" in milliseconds. It doesn't use the built-in
 * `Date` class internally, and instead uses a node facility that uses a
 * monotonic clock. Thus, the time difference computed is not subject to time
 * drifting due to e.g changes in the wall clock system time.
 *
 * @param {arrayOfNumber} relativeTo: an array representing the starting time as
 *        returned by `process.hrtime()` from which to compute the
 *        time difference.
 */
function monotonicTimeDiffMs(relativeTo) {
    assert.arrayOfNumber(relativeTo, 'relativeTo');

    var diff = process.hrtime(relativeTo);
    var ms = (diff[0] * 1e3) + (diff[1] / 1e6); // in milliseconds
    return ms;
}


/*
 * Parse the given line into an argument vector, e.g. for use in sending to
 * `child_process.spawn(argv[0], argv.slice(1), ...)`.
 *
 * Translated from the Python `line2argv` in https://github.com/trentm/cmdln
 * See also the tests in "test/unit/argvFromLine.test.js".
 *
 * @throws {Error} if there are unbalanced quotes or some other parse failure.
 */
function argvFromLine(line) {
    assert.string(line, 'line');

    var trimmed = line.trim();
    var argv = [];
    var state = 'default';
    var arg = null; // the current argument being parsed
    var i = -1;
    var WHITESPACE = {
        ' ': true,
        '\t': true,
        '\n': true,
        '\r': true
        // Other whitespace chars?
    };

    while (true) {
        i += 1;
        if (i >= trimmed.length) {
            break;
        }
        var ch = trimmed[i];

        // An escaped char always added to the arg.
        if (ch == '\\' && i+1 < trimmed.length) {
            if (arg === null) { arg = ''; }
            /*
             * Include the escaping backslash, unless it is escaping a quote
             * inside a quoted string. E.g.:
             *      foo\Xbar    =>  foo\Xbar
             *      'foo\'bar'  =>  foo'bar
             *      "foo\"bar"  =>  foo"bar
             *
             * Note that cmdln.py's line2argv had a Windows-specific subtlety
             * here (dating to cmdln commit 87430930160f) that we are skipping
             * for now.
             */
            if ((state === 'double-quoted' && trimmed[i+1] !== '"') ||
                (state === 'single-quoted' && trimmed[i+1] !== '\'')) {
                arg += ch;
            }
            i += 1;
            arg += trimmed[i];
            continue;
        }

        if (state === 'single-quoted') {
            if (ch === '\'') {
                state = 'default';
            } else {
                arg += ch;
            }
        } else if (state === 'double-quoted') {
            if (ch === '"') {
                state = 'default';
            } else {
                arg += ch;
            }
        } else if (state === 'default') {
            if (ch === '"') {
                if (arg === null) { arg = ''; }
                state = 'double-quoted';
            } else if (ch === '\'') {
                if (arg === null) { arg = ''; }
                state = 'single-quoted';
            } else if (WHITESPACE.hasOwnProperty(ch)) {
                if (arg !== null) {
                    argv.push(arg);
                }
                arg = null;
            } else {
                if (arg === null) { arg = ''; }
                arg += ch;
            }
        }
    }
    if (arg !== null) {
        argv.push(arg);
    }

    /*
     * Note: cmdln.py's line2argv would not throw this error on Windows, i.e.
     * allowing unclosed quoted-strings. This impl. is not following that lead.
     */
    if (state !== 'default') {
        throw new Error(format('unfinished %s segment in line: %j',
            state, line));
    }

    return argv;
}

/*
 * Read stdin in and callback with it as a string
 *
 * @param {Function} cb - callback in the form `function (str) {}`
 */
function readStdin(cb) {
    assert.func(cb, 'cb');

    var stdin = '';
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', function stdinOnData(chunk) {
        stdin += chunk;
    });
    process.stdin.on('end', function stdinOnEnd() {
        cb(stdin);
    });
}

/*
 * Validate an object of values against an object of types.
 *
 * Example:
 * var input = {
 *     foo: 'hello',
 *     bar: 42,
 *     baz: true
 * };
 * var valid = {
 *     foo: 'string',
 *     bar: 'number',
 *     baz: 'boolean'
 * }
 * validateObject(input, valid);
 * // no error is thrown
 *
 * All keys in `input` are check for their matching counterparts in `valid`.
 * If the key is not found in `valid`, or the type specified for the key in
 * `valid` doesn't match the type of the value in `input` an error is thrown.
 * Also an error is thrown (optionally, enabled by default) if the input object
 * is empty.  Note that any keys found in `valid` not found in `input` are not
 * considered an error.
 *
 * @param {Object} input - Required. Input object of values.
 * @param {Object} valid - Required. Validation object of types.
 * @param {Object} opts: Optional
 *               - @param {Boolean} allowEmptyInput - don't consider an empty
 *               input object an error
 * @throws {Error} if the input object contains a key not found in the
 * validation object
 */
function validateObject(input, valid, opts) {
    opts = opts || {};

    assert.object(input, 'input');
    assert.object(valid, 'valid');
    assert.object(opts, 'opts');
    assert.optionalBool(opts.allowEmptyInput, 'opts.allowEmptyInput');

    var validFields = Object.keys(valid).sort().join(', ');
    var i = 0;

    Object.keys(input).forEach(function (key) {
        var value = input[key];
        var type = valid[key];

        if (!type) {
            throw new errors.UsageError(format('unknown or ' +
                'unupdateable field: %s (updateable fields are: %s)',
                key, validFields));
        }
        assert.string(type, 'type');

        if (typeof (value) !== type) {
            throw new errors.UsageError(format('field "%s" must be ' +
                'of type "%s", but got a value of type "%s"',
                key, type, typeof (value)));
        }
        i++;
    });

    if (i === 0 && !opts.allowEmptyInput) {
        throw new errors.UsageError('Input object must not be empty');
    }
}

/*
 * Convert an IPv4 address (as a string) to a number
 */
function ipv4ToLong(ip) {
    var l = 0;
    var spl;

    assert.string(ip, 'ip');
    spl = ip.split('.');
    assert.equal(spl.length, 4, 'ip octet length');

    spl.forEach(function processIpOctet(octet) {
        octet = parseInt(octet, 10);

        assert.number(octet, 'octet');
        assert(octet >= 0, 'octet >= 0');
        assert(octet < 256, 'octet < 256');

        l <<= 8;
        l += octet;
    });

    return l;
}

/*
 * Parse the input from the `--nics <nic>` CLI argument.
 *
 * @param a {Array} The array of strings formatted as key=value
 *                   ex: ['ipv4_uuid=1234', 'ipv4_ips=1.2.3.4|5.6.7.8']
 * @return {Object} A network object.  From the example above:
 * {
 *     "ipv4_uuid": 1234,
 *     "ipv4_ips": [
 *         "1.2.3.4",
 *         "5.6.7.8"
 *      ]
 * }
 * Note: "1234" is used as the UUID for this example, but would actually cause
 * `parseNicStr` to throw as it is not a valid UUID.
 */
function parseNicStr(nic) {
    assert.arrayOfString(nic);

    var obj = objFromKeyValueArgs(nic, {
        disableDotted: true,
        typeHintFromKey: NETWORK_OBJECT_FIELDS,
        validKeys: Object.keys(NETWORK_OBJECT_FIELDS)
    });

    if (!obj.ipv4_uuid) {
        throw new errors.UsageError(
            'ipv4_uuid must be specified in network object');
    }

    if (obj.ipv4_ips) {
        obj.ipv4_ips = obj.ipv4_ips.split('|');
    }

    assert.uuid(obj.ipv4_uuid, 'obj.ipv4_uuid');
    assert.optionalArrayOfString(obj.ipv4_ips, 'obj.ipv4_ips');

    /*
     * Only 1 IP address may be specified at this time.  In the future, this
     * limitation should be removed.
     */
    if (obj.ipv4_ips && obj.ipv4_ips.length !== 1) {
        throw new errors.UsageError('only 1 ipv4_ip may be specified');
    }

    return obj;
}

/*
 * Return a short image string that represents the given image object.
 *
 * @param img {Object} The image object.
 * @returns {String} A network object. E.g.
 *   'a6cf222d-73f4-414c-a427-5c238ef8e1b7 (jillmin@1.0.0)'
 */
function imageRepr(img) {
    assert.object(img);

    return format('%s (%s@%s)', img.id, img.name, img.version);
}


//---- exports

module.exports = {
    objCopy: objCopy,
    deepObjCopy: deepObjCopy,
    objMerge: objMerge,
    zeroPad: zeroPad,
    boolFromString: boolFromString,
    jsonStream: jsonStream,
    longAgo: longAgo,
    isUUID: isUUID,
    humanDurationFromMs: humanDurationFromMs,
    humanSizeFromBytes: humanSizeFromBytes,
    capitalize: capitalize,
    normShortId: normShortId,
    uuidToShortId: uuidToShortId,
    profileSlug: profileSlug,
    filenameSlug: filenameSlug,
    getCliTableOptions: getCliTableOptions,
    promptYesNo: promptYesNo,
    promptEnter: promptEnter,
    promptField: promptField,
    promptPassphraseUnlockKey: promptPassphraseUnlockKey,
    cliSetupTritonApi: cliSetupTritonApi,
    editInEditor: editInEditor,
    ansiStylize: ansiStylize,
    ansiStylizeTty: ansiStylizeTty,
    indent: indent,
    chomp: chomp,
    generatePassword: generatePassword,
    execPlus: execPlus,
    deepEqual: deepEqual,
    tildeSync: tildeSync,
    objFromKeyValueArgs: objFromKeyValueArgs,
    argvFromLine: argvFromLine,
    jsonPredFromKv: jsonPredFromKv,
    monotonicTimeDiffMs: monotonicTimeDiffMs,
    readStdin: readStdin,
    validateObject: validateObject,
    ipv4ToLong: ipv4ToLong,
    parseNicStr: parseNicStr,
    imageRepr: imageRepr
};
// vim: set softtabstop=4 shiftwidth=4:
