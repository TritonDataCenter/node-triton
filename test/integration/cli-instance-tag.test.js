/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Test 'triton inst tag ...'.
 */

var f = require('util').format;
var os = require('os');
var path = require('path');
var tabula = require('tabula');
var test = require('tape');
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');


// --- globals

var INST_ALIAS = f('nodetritontest-insttag-%s', os.hostname());

var opts = {
    skip: !h.CONFIG.allowWriteActions
};


// --- Tests

if (opts.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}
test('triton inst tag ...', opts, function (tt) {
    tt.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        tt.comment(f('- %s: %j', key, value));
    });

    var inst;

    tt.test('  cleanup: rm inst ' + INST_ALIAS + ' if exists', function (t) {
        h.triton(['inst', 'get', '-j', INST_ALIAS],
                function (err, stdout, stderr) {
            if (err) {
                if (err.code === 3) {  // `triton` code for ResourceNotFound
                    t.ok(true, 'no pre-existing alias in the way');
                    t.end();
                } else {
                    t.ifErr(err);
                    t.end();
                }
            } else {
                var oldInst = JSON.parse(stdout);
                h.safeTriton(t, ['delete', '-w', oldInst.id], function (dErr) {
                    t.ifError(dErr, 'deleted old inst ' + oldInst.id);
                    t.end();
                });
            }
        });
    });

    var imgId;
    tt.test('  setup: find test image', function (t) {
        h.getTestImg(t, function (err, imgId_) {
            t.ifError(err, 'getTestImg' + (err ? ': ' + err : ''));
            imgId = imgId_;
            t.end();
        });
    });

    var pkgId;
    tt.test('  setup: find test package', function (t) {
        h.getTestPkg(t, function (err, pkgId_) {
            t.ifError(err, 'getTestPkg' + (err ? ': ' + err : ''));
            pkgId = pkgId_;
            t.end();
        });
    });

    // create a test machine (blocking) and output JSON
    tt.test('  setup: triton create ' + INST_ALIAS, function (t) {
        var argv = [
            'create',
            '-wj',
            '--tag', 'blah=bling',
            '-n', INST_ALIAS,
            imgId, pkgId
        ];

        var start = Date.now();
        h.safeTriton(t, argv, function (err, stdout) {
            var elapsedSec = Math.round((Date.now() - start) / 1000);
            t.ok(true, 'created test inst ('+ elapsedSec + 's)');
            var lines = h.jsonStreamParse(stdout);
            inst = lines[1];
            t.equal(lines[0].tags.blah, 'bling', '"blah" tag set');
            t.equal(lines[1].state, 'running', 'inst is running');
            t.end();
        });
    });

    tt.test('  triton inst tag ls INST', function (t) {
        h.safeTriton(t, ['inst', 'tag', 'ls', inst.name],
                function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {blah: 'bling'});
            t.end();
        });
    });

    tt.test('  triton inst tags INST', function (t) {
        h.safeTriton(t, ['inst', 'tags', inst.name], function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {blah: 'bling'});
            t.end();
        });
    });

    tt.test('  triton inst tag set -w INST name=value', function (t) {
        var argv = ['inst', 'tag', 'set', '-w', inst.id,
            'foo=bar', 'pi=3.14', 'really=true'];
        h.safeTriton(t, argv, function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {
                blah: 'bling',
                foo: 'bar',
                pi: 3.14,
                really: true
            });
            t.end();
        });
    });

    tt.test('  triton inst get INST foo', function (t) {
        h.safeTriton(t, ['inst', 'tag', 'get', inst.id.split('-')[0], 'foo'],
                function (err, stdout) {
            t.equal(stdout.trim(), 'bar');
            t.end();
        });
    });

    tt.test('  triton inst get INST foo -j', function (t) {
        h.safeTriton(t, ['inst', 'tag', 'get', inst.id, 'foo', '-j'],
                function (err, stdout) {
            t.equal(stdout.trim(), '"bar"');
            t.end();
        });
    });

    tt.test('  triton inst get INST really -j', function (t) {
        h.safeTriton(t, ['inst', 'tag', 'get', inst.name, 'really', '-j'],
                function (err, stdout) {
            t.equal(stdout.trim(), 'true');
            t.end();
        });
    });

    tt.test('  triton inst tag set -w INST -f tags.json', function (t) {
        var argv = ['inst', 'tag', 'set', '-w', inst.name, '-f',
            path.resolve(__dirname, 'data', 'tags.json')];
        h.safeTriton(t, argv, function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {
                blah: 'bling',
                foo: 'bling',
                pi: 3.14,
                really: true
            });
            t.end();
        });
    });

    tt.test('  triton inst tag set -w INST -f tags.kv', function (t) {
        var argv = ['inst', 'tag', 'set', '-w', inst.name, '-f',
            path.resolve(__dirname, 'data', 'tags.kv')];
        h.safeTriton(t, argv, function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {
                blah: 'bling',
                foo: 'bling',
                pi: 3.14,
                really: true,
                key: 'value',
                beep: 'boop'
            });
            t.end();
        });
    });

    tt.test('  triton inst tag rm -w INST key really', function (t) {
        var argv = ['inst', 'tag', 'rm', '-w', inst.name, 'key', 'really'];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = stdout.trim().split(/\n/);
            t.ok(/^Deleted tag key/.test(lines[0]),
                'Deleted tag key ...:' + lines[0]);
            t.ok(/^Deleted tag really/.test(lines[1]),
                'Deleted tag really ...:' + lines[1]);
            t.end();
        });
    });

    tt.test('  triton inst tag list INST', function (t) {
        var argv = ['inst', 'tag', 'list', inst.name];
        h.safeTriton(t, argv, function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {
                blah: 'bling',
                foo: 'bling',
                pi: 3.14,
                beep: 'boop'
            });
            t.end();
        });
    });

    tt.test('  triton inst tag replace-all -w INST ...', function (t) {
        var argv = ['inst', 'tag', 'replace-all', '-w',
            inst.name, 'whoa=there'];
        h.safeTriton(t, argv, function (err, stdout) {
            var tags = JSON.parse(stdout);
            t.deepEqual(tags, {
                whoa: 'there'
            });
            t.end();
        });
    });

    tt.test('  triton inst tag delete -w -a INST', function (t) {
        var argv = ['inst', 'tag', 'delete', '-w', '-a', inst.name];
        h.safeTriton(t, argv, function (err, stdout) {
            t.equal(stdout.trim(), 'Deleted all tags on instance ' + inst.name);
            t.end();
        });
    });

    tt.test('  triton inst tags INST', function (t) {
        var argv = ['inst', 'tags', inst.name];
        h.safeTriton(t, argv, function (err, stdout) {
            t.equal(stdout.trim(), '{}');
            t.end();
        });
    });

    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    tt.test('  cleanup: triton rm INST', {timeout: 10 * 60 * 1000},
            function (t) {
        h.safeTriton(t, ['rm', '-w', inst.id], function (err, stdout) {
            t.end();
        });
    });

});
