/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Unit tests for `tagsFromOpts()` used by `triton create ...`.
 */

var assert = require('assert-plus');
var cmdln = require('cmdln');
var format = require('util').format;
var test = require('tape');

var tagsFromOpts = require('../../lib/do_instance/do_create').tagsFromOpts;


// ---- globals

var log = require('../lib/log');

var debug = function () {};
// debug = console.warn;


// ---- test cases

var OPTIONS = [
    {
        names: ['tag', 't'],
        type: 'arrayOfString'
    }
];

var cases = [
    {
        argv: ['triton', 'create', '-t', 'foo=bar'],
        expect: {
            tags: {foo: 'bar'}
        }
    },
    {
        argv: ['triton', 'create', '--tag', 'foo=bar'],
        expect: {
            tags: {foo: 'bar'}
        }
    },
    {
        argv: ['triton', 'create', '-t', 'foo=bar', '-t', 'bling=bloop'],
        expect: {
            tags: {
                foo: 'bar',
                bling: 'bloop'
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-t', 'num=42',
            '-t', 'pi=3.14',
            '-t', 'yes=true',
            '-t', 'no=false',
            '-t', 'array=[1,2,3]'],
        expect: {
            tags: {
                num: 42,
                pi: 3.14,
                yes: true,
                no: false,
                array: '[1,2,3]'
            }
        }
    },

    {
        argv: ['triton', 'create',
            '-t', '@' + __dirname + '/corpus/metadata.json'],
        expect: {
            tags: {
                'foo': 'bar',
                'one': 'four',
                'num': 42
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-t', '@' + __dirname + '/corpus/metadata.kv'],
        expect: {
            tags: {
                'foo': 'bar',
                'one': 'four',
                'num': 42
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-t', '@' + __dirname + '/corpus/metadata-illegal-types.json'],
        expect: {
            err: [
                /* jsl:ignore */
                /invalid tag value type/,
                /\(from .*corpus\/metadata-illegal-types.json\)/,
                /must be one of string/
                /* jsl:end */
            ]
        }
    },
    {
        argv: ['triton', 'create',
            '-t', '@' + __dirname + '/corpus/metadata-invalid-json.json'],
        expect: {
            err: [
                /* jsl:ignore */
                /is not valid JSON/,
                /corpus\/metadata-invalid-json.json/
                /* jsl:end */
            ]
        }
    },

    {
        argv: ['triton', 'create',
            '-t', '{"foo":"bar","num":12}'],
        expect: {
            tags: {
                'foo': 'bar',
                'num': 12
            }
        }
    }
];


// ---- test driver

test('tagsFromOpts', function (tt) {
    cases.forEach(function (c, num) {
        var testName = format('case %d: %s', num, c.argv.join(' '));
        tt.test(testName, function (t) {
            debug('--', num);
            debug('c: %j', c);
            var parser = new cmdln.dashdash.Parser({options: OPTIONS});
            var opts = parser.parse({argv: c.argv});
            debug('opts: %j', opts);

            // Capture stderr for warnings while running.
            var stderrChunks = [];
            var _oldStderrWrite = process.stderr.write;
            process.stderr.write = function (s) {
                stderrChunks.push(s);
            };

            tagsFromOpts(opts, log, function (err, tags) {
                // Restore stderr.
                process.stderr.write = _oldStderrWrite;
                var stderr = stderrChunks.join('');

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
                    t.ifError(err);
                }
                if (c.expect.hasOwnProperty('tags')) {
                    t.deepEqual(tags, c.expect.tags);
                }
                if (c.expect.hasOwnProperty('stderr')) {
                    var stderrRegexps = (Array.isArray(c.expect.stderr)
                        ? c.expect.stderr : [c.expect.stderr]);
                    stderrRegexps.forEach(function (regexp) {
                        assert.regexp(regexp, 'case.expect.stderr');
                        t.ok(regexp.test(stderr), format(
                            'error message matches %s, actual %j',
                            regexp, stderr));
                    });

                }
                t.end();
            });
        });
    });
});
