/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test create/start/stop/delete/etc. work flows
 */

var f = require('util').format;
var os = require('os');
var tabula = require('tabula');
var test = require('tape');
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');


// --- globals

var INST_ALIAS = f('node-triton-test-%s-vm1', os.hostname());

var opts = {
    skip: !h.CONFIG.allowWriteActions
};

// global variable to hold vm instance JSON
var instance;


// --- internal support stuff

function _jsonStreamParse(s) {
    var results = [];
    var lines = s.split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) {
            results.push(JSON.parse(line));
        }
    }
    return results;
}


// --- Tests

if (opts.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}
test('triton manage workflow', opts, function (tt) {
    tt.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        tt.comment(f('- %s: %j', key, value));
    });

    tt.test('  cleanup existing inst with alias ' + INST_ALIAS, function (t) {
        h.triton(['inst', 'get', '-j', INST_ALIAS],
                function (err, stdout, stderr) {
            if (err) {
                if (err.code === 3) {  // `triton` code for ResourceNotFound
                    t.ok(true, 'no pre-existing alias in the way');
                    t.end();
                } else {
                    t.ifErr(err, err);
                    t.end();
                }
            } else {
                var inst = JSON.parse(stdout);
                h.safeTriton(t, ['delete', '-w', inst.id], function () {
                    t.ok(true, 'deleted inst ' + inst.id);
                    t.end();
                });
            }
        });
    });

    var imgId;
    tt.test('  find image to use', function (t) {
        if (h.CONFIG.image) {
            imgId = h.CONFIG.image;
            t.ok(imgId, 'image from config: ' + imgId);
            t.end();
            return;
        }

        var candidateImageNames = {
            'base-64-lts': true,
            'base-64': true,
            'minimal-64': true,
            'base-32-lts': true,
            'base-32': true,
            'minimal-32': true,
            'base': true
        };
        h.safeTriton(t, ['img', 'ls', '-j'], function (stdout) {
            var imgs = _jsonStreamParse(stdout);
            // Newest images first.
            tabula.sortArrayOfObjects(imgs, ['-published_at']);
            var imgRepr;
            for (var i = 0; i < imgs.length; i++) {
                var img = imgs[i];
                if (candidateImageNames[img.name]) {
                    imgId = img.id;
                    imgRepr = f('%s@%s', img.name, img.version);
                    break;
                }
            }

            t.ok(imgId, f('latest available base/minimal image: %s (%s)',
                imgId, imgRepr));
            t.end();
        });
    });

    var pkgId;
    tt.test('  find package to use', function (t) {
        if (h.CONFIG.package) {
            pkgId = h.CONFIG.package;
            t.ok(pkgId, 'package from config: ' + pkgId);
            t.end();
            return;
        }

        h.safeTriton(t, ['pkg', 'list', '-j'], function (stdout) {
            var pkgs = _jsonStreamParse(stdout);
            // Smallest RAM first.
            tabula.sortArrayOfObjects(pkgs, ['memory']);
            pkgId = pkgs[0].id;
            t.ok(pkgId, f('smallest (RAM) available package: %s (%s)',
                pkgId, pkgs[0].name));
            t.end();
        });
    });

    // create a test machine (blocking) and output JSON
    tt.test('  triton create', function (t) {
        var argv = [
            'create',
            '-wj',
            '-m', 'foo=bar',
            '--script', __dirname + '/script-log-boot.sh',
            '--tag', 'blah=bling',
            '-n', INST_ALIAS,
            imgId, pkgId
        ];

        h.safeTriton(t, argv, function (stdout) {
            // parse JSON response
            var lines = stdout.trim().split('\n');
            t.equal(lines.length, 2, 'correct number of JSON lines');
            try {
                lines = lines.map(function (line) {
                    return JSON.parse(line);
                });
            } catch (e) {
                t.fail('failed to parse JSON');
                t.end();
            }

            instance = lines[1];
            t.equal(lines[0].id, lines[1].id, 'correct UUID given');
            t.equal(lines[0].metadata.foo, 'bar', 'foo metadata set');
            t.ok(lines[0].metadata['user-script'], 'user-script set');
            t.equal(lines[0].tags.blah, 'bling', 'blah tag set');
            t.equal(lines[1].state, 'running', 'correct machine state');

            t.end();
        });
    });

    // test `triton instance -j` with the UUID, the alias, and the short ID
    tt.test('  triton instance get', function (t) {
        var uuid = instance.id;
        var shortId = common.uuidToShortId(uuid);
        vasync.parallel({
            funcs: [
                function (cb) {
                    h.safeTriton(t, ['instance', 'get', '-j', INST_ALIAS],
                        function (stdout) {
                        cb(null, stdout);
                    });
                },
                function (cb) {
                    h.safeTriton(t, ['instance', 'get', '-j', uuid],
                        function (stdout) {
                        cb(null, stdout);
                    });
                },
                function (cb) {
                    h.safeTriton(t, ['instance', 'get', '-j', shortId],
                        function (stdout) {
                        cb(null, stdout);
                    });
                }
            ]
        }, function (err, results) {
            if (h.ifErr(t, err, 'no error'))
                return t.end();

            var output;
            try {
                output = results.operations.map(function (op) {
                    return JSON.parse(op.result);
                });
            } catch (e) {
                t.fail('failed to parse JSON');
                t.end();
            }

            t.equal(output[0].metadata.foo, 'bar', 'foo metadata set');
            output.forEach(function (res) {
                t.deepEqual(output[0], res, 'same data');
            });

            t.end();
        });
    });

    // remove instance
    tt.test('  triton delete', function (t) {
        h.safeTriton(t, ['delete', '-w', instance.id], function (stdout) {
            t.end();
        });
    });

    // TODO: would be nice to have a `triton ssh cat /var/log/boot.log` to
    //      verify the user-script worked.

    // create a test machine (non-blocking)
    tt.test('  triton create', function (t) {
        h.safeTriton(t, ['create', '-jn', INST_ALIAS, imgId, pkgId],
            function (stdout) {

            // parse JSON response
            var lines = stdout.trim().split('\n');
            t.equal(lines.length, 1, 'correct number of JSON lines');
            var d;
            try {
                d = JSON.parse(lines[0]);
            } catch (e) {
                t.fail('failed to parse JSON');
                t.end();
            }
            instance = d;

            t.equal(d.state, 'provisioning', 'correct machine state');

            t.end();
        });
    });

    // wait for the machine to start
    tt.test('  triton wait', function (t) {
        h.safeTriton(t, ['wait', instance.id],
            function (stdout) {

            // parse JSON response
            var lines = stdout.trim().split('\n');
            t.equal(lines.length, 2, 'correct number of stdout lines');

            t.ok(lines[0].match(/\(states: running, failed\)$/),
                'first line correct');
            t.ok(lines[1].match(/moved to state running$/),
                'second line correct');

            t.end();
        });
    });

    // stop the machine
    tt.test('  triton stop', function (t) {
        h.safeTriton(t, ['stop', '-w', INST_ALIAS],
            function (stdout) {
            t.ok(stdout.match(/^Stop instance/, 'correct stdout'));
            t.end();
        });
    });

    // wait for the machine to stop
    tt.test('  triton confirm stopped', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j', INST_ALIAS]},
            function (d) {
            instance = d;

            t.equal(d.state, 'stopped', 'machine stopped');

            t.end();
        });
    });

    // start the machine
    tt.test('  triton start', function (t) {
        h.safeTriton(t, ['start', '-w', INST_ALIAS],
            function (stdout) {
            t.ok(stdout.match(/^Start instance/, 'correct stdout'));
            t.end();
        });
    });

    // wait for the machine to start
    tt.test('  confirm running', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j', INST_ALIAS]},
                function (d) {
            instance = d;
            t.equal(d.state, 'running', 'machine running');
            t.end();
        });
    });

    // remove test instance
    tt.test('  cleanup (triton delete)', function (t) {
        h.safeTriton(t, ['delete', '-w', instance.id], function (stdout) {
            t.end();
        });
    });

});
