/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Unit tests for `metadataFromOpts()` used by `triton create ...`.
 */

var assert = require('assert-plus');
var cmdln = require('cmdln');
var format = require('util').format;
var test = require('tap').test;

var metadataFromOpts = require('../../lib/metadataandtags').metadataFromOpts;


// ---- globals

var log = require('../lib/log');

var debug = function () {};
// debug = console.warn;


// ---- test cases

var OPTIONS = [
    {
        names: ['metadata', 'm'],
        type: 'arrayOfString'
    },
    {
        names: ['metadata-file', 'M'],
        type: 'arrayOfString'
    },
    {
        names: ['script'],
        type: 'arrayOfString'
    }
];

var cases = [
    {
        argv: ['triton', 'create', '-m', 'foo=bar'],
        expect: {
            metadata: {foo: 'bar'}
        }
    },
    {
        argv: ['triton', 'create', '-m', 'foo=bar', '-m', 'bling=bloop'],
        expect: {
            metadata: {
                foo: 'bar',
                bling: 'bloop'
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-m', 'num=42',
            '-m', 'pi=3.14',
            '-m', 'yes=true',
            '-m', 'no=false',
            '-m', 'array=[1,2,3]'],
        expect: {
            metadata: {
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
            '-m', '@' + __dirname + '/corpus/metadata.json'],
        expect: {
            metadata: {
                'foo': 'bar',
                'one': 'four',
                'num': 42
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-m', '@' + __dirname + '/corpus/metadata.kv'],
        expect: {
            metadata: {
                'foo': 'bar',
                'one': 'four',
                'num': 42
            }
        }
    },
    {
        argv: ['triton', 'create',
            '--script', __dirname + '/corpus/user-script.sh'],
        expect: {
            metadata: {
                'user-script': '#!/bin/sh\necho "hi"\n'
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-m', 'foo=bar',
            '-M', 'user-script=' + __dirname + '/corpus/user-script.sh'],
        expect: {
            metadata: {
                foo: 'bar',
                'user-script': '#!/bin/sh\necho "hi"\n'
            }
        }
    },
    {
        argv: ['triton', 'create',
            '-m', 'foo=bar',
            '--metadata-file', 'foo=' + __dirname + '/corpus/user-script.sh'],
        expect: {
            metadata: {
                'foo': '#!/bin/sh\necho "hi"\n'
            },
            /* JSSTYLED */
            stderr: /warning: metadata "foo=.* replaces earlier value for "foo"/
        }
    },
    {
        argv: ['triton', 'create',
            '-m', '@' + __dirname + '/corpus/metadata-illegal-types.json'],
        expect: {
            err: [
                /* jsl:ignore */
                /invalid metadata value type/,
                /\(from .*corpus\/metadata-illegal-types.json\)/,
                /must be one of string/
                /* jsl:end */
            ]
        }
    },
    {
        argv: ['triton', 'create',
            '-m', '@' + __dirname + '/corpus/metadata-invalid-json.json'],
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
            '-m', '{"foo":"bar","num":12}'],
        expect: {
            metadata: {
                'foo': 'bar',
                'num': 12
            }
        }
    }
];


// ---- test driver

test('metadataFromOpts', function (suite) {
    cases.forEach(function (c, num) {
        var testName = format('case %d: %s', num, c.argv.join(' '));
        suite.test(testName, function (t) {
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

            metadataFromOpts(opts, log, function (err, metadata) {
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
                if (c.expect.hasOwnProperty('metadata')) {
                    t.deepEqual(metadata, c.expect.metadata);
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

    suite.end();
});
