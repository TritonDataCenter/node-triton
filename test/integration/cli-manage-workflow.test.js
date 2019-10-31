/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Test create/start/stop/delete/etc. work flows
 */

var f = require('util').format;
var os = require('os');
var test = require('tap').test;
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');


// --- globals

var INST_ALIAS = f('nodetritontest-managewf-%s', os.hostname());
var INST_ALIAS_NEWNAME = INST_ALIAS + '-renamed';

var testOpts = {
    skip: !h.CONFIG.allowWriteActions && 'requires config.allowWriteActions'
};

// global variable to hold vm instance JSON
var instance;


// --- Tests

test('triton manage workflow', testOpts, function (suite) {
    h.printConfig(suite);

    suite.test('  cleanup existing inst with alias ' + INST_ALIAS,
    function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    var imgId;
    suite.test('  setup: find test image', function (t) {
        h.getTestImg(t, function (err, imgId_) {
            t.ifError(err, 'getTestImg' + (err ? ': ' + err : ''));
            imgId = imgId_;
            t.end();
        });
    });

    var pkgId;
    suite.test('  setup: find test package', function (t) {
        h.getTestPkg(t, function (err, pkgId_) {
            t.ifError(err, 'getTestPkg' + (err ? ': ' + err : ''));
            pkgId = pkgId_;
            t.end();
        });
    });

    var resizePkgName;
    suite.test('  setup: find resize test package', function (t) {
        h.getResizeTestPkg(t, function (err, pkgName_) {
            t.ifError(err, 'getResizeTestPkg' + (err ? ': ' + err : ''));
            resizePkgName = pkgName_;
            t.end();
        });
    });

    // create a test machine (blocking) and output JSON
    suite.test('  setup: triton create', function (t) {
        var argv = [
            'create',
            '-wj',
            '-m', 'foo=bar',
            '--script', __dirname + '/script-log-boot.sh',
            '--tag', 'blah=bling',
            '-n', INST_ALIAS,
            imgId, pkgId
        ];

        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
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
    suite.test('  triton instance get', function (t) {
        var uuid = instance.id;
        var shortId = common.uuidToShortId(uuid);
        vasync.parallel({
            funcs: [
                function (cb) {
                    h.safeTriton(t, ['instance', 'get', '-j', INST_ALIAS], cb);
                },
                function (cb) {
                    h.safeTriton(t, ['instance', 'get', '-j', uuid], cb);
                },
                function (cb) {
                    h.safeTriton(t, ['instance', 'get', '-j', shortId], cb);
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

    // Remove instance. Add a test timeout, because '-w' on delete doesn't
    // have a way to know if the attempt failed or if it is just taking a
    // really long time.
    suite.test('  triton delete', {timeout: 10 * 60 * 1000}, function (t) {
        h.safeTriton(t, ['delete', '-w', '-f', instance.id], function () {
            t.end();
        });
    });

    // Test the '410 Gone' handling from CloudAPI GetMachine.
    suite.test('  triton inst get (deleted)', function (t) {
        h.triton(['inst', 'get', instance.id], function (err, stdout, stderr) {
            t.ok(err, 'got err: ' + err);
            t.equal(err.code, 3, 'exit status of 3');
            var errCodeRe = /InstanceDeleted/;
            t.ok(errCodeRe.exec(stderr),
                f('stderr matched %s: %j', errCodeRe, stderr));
            t.ok(stdout, 'still got stdout');
            var inst = JSON.parse(stdout);
            t.equal(inst.state, 'deleted', 'instance state is "deleted"');
            t.end();
        });
    });

    // TODO: would be nice to have a `triton ssh cat /var/log/boot.log` to
    //      verify the user-script worked.

    // create a test machine (non-blocking)
    suite.test('  triton create', function (t) {
        h.safeTriton(t, ['create', '-jn', INST_ALIAS, imgId, pkgId],
            function (err, stdout) {

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
    suite.test('  triton inst wait', function (t) {
        h.safeTriton(t, ['inst', 'wait', instance.id],
            function (err, stdout) {

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
    suite.test('  triton stop', function (t) {
        h.safeTriton(t, ['stop', '-w', INST_ALIAS], function (err, stdout) {
            t.ok(stdout.match(/^Stop instance/, 'correct stdout'));
            t.end();
        });
    });

    // wait for the machine to stop
    suite.test('  triton confirm stopped', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j', INST_ALIAS]},
                function (err, d) {
            instance = d;
            t.equal(d.state, 'stopped', 'machine stopped');
            t.end();
        });
    });

    // start the machine
    suite.test('  triton start', function (t) {
        h.safeTriton(t, ['start', '-w', INST_ALIAS],
                function (err, stdout) {
            t.ok(stdout.match(/^Start instance/, 'correct stdout'));
            t.end();
        });
    });
    suite.test('  confirm running', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j', INST_ALIAS]},
                function (err, d) {
            instance = d;
            t.equal(d.state, 'running', 'machine running');
            t.end();
        });
    });

    // reboot the machine
    suite.test('  triton reboot', function (t) {
        h.safeTriton(t, ['reboot', '-w', INST_ALIAS],
                function (err, stdout) {
            t.ok(stdout.match(/^Rebooting instance/),
                '"Rebooting ..." in stdout');
            t.ok(stdout.match(/^Rebooted instance/m),
                '"Rebooted ..." in stdout');
            t.end();
        });
    });
    suite.test('  confirm running', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j', INST_ALIAS]},
                function (err, d) {
            instance = d;
            t.equal(d.state, 'running', 'machine running');
            t.end();
        });
    });

    // resize the instance
    suite.test('  triton inst resize', function (t) {
        var args = ['inst', 'resize', '-w', instance.id, resizePkgName];
        h.safeTriton(t, args, function (err, stdout) {
            t.ok(stdout.match(/^Resizing instance/m),
              '"Resizing instance" in stdout');
            t.ok(stdout.match(/^Resized instance/m),
              '"Resized instance" in stdout');
            t.end();
        });
    });

    suite.test('  confirm resized', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j',
              INST_ALIAS]},
          function (err, inst) {
              t.equal(inst.package, resizePkgName, 'instance was resized');
              t.end();
          });
    });

    // rename the instance
    suite.test('  triton inst rename', function (t) {
        var args = ['inst', 'rename', '-w', instance.id, INST_ALIAS_NEWNAME];
        h.safeTriton(t, args, function (err, stdout) {
            t.ok(stdout.match(/^Renaming instance/m),
                '"Renaming instance" in stdout');
            t.ok(stdout.match(/^Renamed instance/m),
                '"Renamed instance" in stdout');
            t.end();
        });
    });

    suite.test('  confirm renamed', function (t) {
        h.safeTriton(t, {json: true, args: ['inst', 'get', '-j',
            INST_ALIAS_NEWNAME]},
                function (err, inst) {
            t.equal(inst.name, INST_ALIAS_NEWNAME, 'instance was renamed');
            t.end();
        });
    });

    // remove test instance
    suite.test('  cleanup (triton delete)', function (t) {
        h.safeTriton(t, ['delete', '-f', '-w', instance.id], function () {
            t.end();
        });
    });

    suite.end();
});
