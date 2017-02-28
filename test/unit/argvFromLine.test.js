/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Unit tests for `argvFromLine()` in "common.js".
 */

var assert = require('assert-plus');
var format = require('util').format;
var test = require('tape');

var argvFromLine = require('../../lib/common').argvFromLine;


// ---- globals

var log = require('../lib/log');

var debug = function () {};
// debug = console.warn;


// ---- test cases

var cases = [
    {
        line: '"/Applications/Mac Vim/MacVim.app/Contents/MacOS/Vim" -fg',
        expect: {
            argv: ['/Applications/Mac Vim/MacVim.app/Contents/MacOS/Vim', '-fg']
        }
    },

    {
        line: 'foo',
        expect: {
            argv: ['foo']
        }
    },
    {
        line: 'foo bar',
        expect: {
            argv: ['foo', 'bar']
        }
    },
    {
        line: 'foo bar ',
        expect: {
            argv: ['foo', 'bar']
        }
    },
    {
        line: ' foo bar',
        expect: {
            argv: ['foo', 'bar']
        }
    },


    // Quote handling
    {
        line: '\'foo bar\'',
        expect: {
            argv: ['foo bar']
        }
    },
    {
        line: '"foo bar"',
        expect: {
            argv: ['foo bar']
        }
    },
    {
        line: '"foo\\"bar"',
        expect: {
            argv: ['foo"bar']
        }
    },
    {
        line: '"foo bar" spam',
        expect: {
            argv: ['foo bar', 'spam']
        }
    },
    {
        line: '"foo "bar spam',
        expect: {
            argv: ['foo bar', 'spam']
        }
    },

    {
        line: 'some\tsimple\ttests',
        expect: {
            argv: ['some', 'simple', 'tests']
        }
    },
    {
        line: 'a "more complex" test',
        expect: {
            argv: ['a', 'more complex', 'test']
        }
    },
    {
        line: 'a more="complex test of " quotes',
        expect: {
            argv: ['a', 'more=complex test of ', 'quotes']
        }
    },
    {
        line: 'a more" complex test of " quotes',
        expect: {
            argv: ['a', 'more complex test of ', 'quotes']
        }
    },
    {
        line: 'an "embedded \\"quote\\""',
        expect: {
            argv: ['an', 'embedded "quote"']
        }
    },

    {
        line: 'foo bar C:\\',
        expect: {
            argv: ['foo', 'bar', 'C:\\']
        }
    },
    {
        line: '"\\test\\slash" "foo bar" "foo\\"bar"',
        expect: {
            argv: ['\\test\\slash', 'foo bar', 'foo"bar']
        }
    },

    {
        line: '\\foo\\bar',
        expect: {
            argv: ['foobar']
        }
    },
    {
        line: '\\\\foo\\\\bar',
        expect: {
            argv: ['\\foo\\bar']
        }
    },

    {
        line: '"foo',
        expect: {
            err: /unfinished .* segment in line/
        }
    }
];


// ---- test driver

test('argvFromLine', function (tt) {
    cases.forEach(function (c, num) {
        var testName = format('case %d: %s', num, c.line);
        tt.test(testName, function (t) {
            debug('--', num);
            debug('c: %j', c);

            var argv = null;
            var err = null;
            try {
                argv = argvFromLine(c.line);
            } catch (err_) {
                err = err_;
            }

            if (c.expect.err) {
                var errRegexps = (Array.isArray(c.expect.err)
                    ? c.expect.err : [c.expect.err]);
                errRegexps.forEach(function (regexp) {
                    assert.regexp(regexp, 'case.expect.err');
                    t.ok(err, 'expected an error');
                    t.ok(regexp.test(err.message), format(
                        'error message matches %s, actual %j',
                        regexp, err.message));
                });
            } else {
                t.ifError(err, 'no err');
            }
            if (c.expect.hasOwnProperty('argv')) {
                t.deepEqual(argv, c.expect.argv);
            }
            t.end();
        });
    });
});
