/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
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
 * given an array of key=value pairs, break them into an object
 *
 * @param {Array} kvs - an array of key=value pairs
 * @param {Array} valid (optional) - an array to validate pairs
 *
 * TODO: merge this with objFromKeyValueArgs !
 */
function kvToObj(kvs, valid) {
    assert.arrayOfString(kvs, 'kvs');
    assert.optionalArrayOfString(valid, 'valid');

    var o = {};
    for (var i = 0; i < kvs.length; i++) {
        var kv = kvs[i];
        var idx = kv.indexOf('=');
        if (idx === -1)
             throw new errors.UsageError(format(
                'invalid filter: "%s" (must be of the form "field=value")',
                kv));
        var k = kv.slice(0, idx);
        var v = kv.slice(idx + 1);
        if (valid && valid.indexOf(k) === -1)
             throw new errors.UsageError(format(
                'invalid filter name: "%s" (must be one of "%s")',
                k, valid.join('", "')));
        o[k] = v;
    }
    return o;
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
    var account = o.account.replace(/[@]/g, '_');
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
        stdin.setRawMode(false);
        stdin.pause();
        stdin.write('\n');
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
    var wrap = wordwrap(Math.min(process.stdout.columns, 78));

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
        console.log(ansiStylize(wrap(field.desc), 'bold'));
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
    assert.func(cb, 'cb');

    var tmpPath = path.resolve(os.tmpDir(),
        format('triton-%s-edit-%s', process.pid, opts.filename || 'text'));
    fs.writeFileSync(tmpPath, opts.text, 'utf8');

    // TODO: want '-f' opt for vi? What about others?
    var editor = process.env.EDITOR || '/usr/bin/vi';
    var kid = child_process.spawn(editor, [tmpPath], {stdio: 'inherit'});
    kid.on('exit', function (code) {
        if (code) {
            return (cb(code));
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
 */
function objFromKeyValueArgs(args, opts)
{
    assert.arrayOfString(args, 'args');
    assert.optionalObject(opts, 'opts');
    opts = opts || {};
    assert.optionalBool(opts.disableDotted, 'opts.disableDotted');
    assert.optionalObject(opts.typeHintFromKey, opts.typeHintFromKey);
    var typeHintFromKey = opts.typeHintFromKey || {};

    var obj = {};
    args.forEach(function (arg) {
        var kv = strsplit(arg, '=', 2);
        if (kv.length < 2) {
            throw new TypeError(format('invalid key=value argument: "%s"',
                arg));
        }

        var k = kv[0];
        var t = typeHintFromKey[k];

        var v = kv[1];
        if (t === 'string') {
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

        if (opts.disableDotted) {
            obj[k] = v;
        } else {
            var dotted = strsplit(k, '.', 2);
            if (dotted.length > 1) {
                if (!obj[dotted[0]]) {
                    obj[dotted[0]] = {};
                }
                obj[dotted[0]][dotted[1]] = v;
            } else {
                obj[k] = v;
            }
        }
    });

    return obj;
}



//---- exports

module.exports = {
    objCopy: objCopy,
    deepObjCopy: deepObjCopy,
    objMerge: objMerge,
    zeroPad: zeroPad,
    boolFromString: boolFromString,
    jsonStream: jsonStream,
    kvToObj: kvToObj,
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
    indent: indent,
    chomp: chomp,
    generatePassword: generatePassword,
    execPlus: execPlus,
    deepEqual: deepEqual,
    tildeSync: tildeSync,
    objFromKeyValueArgs: objFromKeyValueArgs
};
// vim: set softtabstop=4 shiftwidth=4:
