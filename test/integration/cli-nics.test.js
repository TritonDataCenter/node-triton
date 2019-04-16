/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Integration tests for `triton instance nics ...`
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tap').test;

// --- Globals

var INST_ALIAS = f('nodetritontest-nics-%s', os.hostname());
var NETWORK;
var INST;
var NIC;
var NIC2;

var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};


// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton instance nics', OPTS, function (suite) {
    h.printConfig(suite);

    suite.test('  cleanup existing inst with alias ' + INST_ALIAS,
    function (t) {
        h.deleteTestInst(t, INST_ALIAS, function onDelete(err) {
            t.ifErr(err);
            t.end();
        });
    });

    suite.test('  setup: triton instance create', function (t) {
        h.createTestInst(t, INST_ALIAS, {}, function onInst(err, instId) {
            if (h.ifErr(t, err, 'triton instance create')) {
                t.end();
                return;
            }

            t.ok(instId, 'created instance ' + instId);
            INST = instId;

            t.end();
        });
    });

    suite.test('  setup: find network for tests', function (t) {
        h.triton('network list -j', function onNetworks(err, stdout) {
            if (h.ifErr(t, err, 'triton network list')) {
                t.end();
                return;
            }

            NETWORK = JSON.parse(stdout.trim().split('\n')[0]);
            t.ok(NETWORK, 'NETWORK');

            t.end();
        });
    });

    suite.test('  triton instance nic create', function (t) {
        var cmd = 'instance nic create -j -w ' + INST + ' ' + NETWORK.id;

        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic create')) {
                t.end();
                return;
            }

            NIC = JSON.parse(stdout);
            t.ok(NIC, 'created NIC: ' + stdout.trim());

            t.end();
        });
    });

    suite.test('  triton instance nic get', function (t) {
        var cmd = 'instance nic get ' + INST + ' ' + NIC.mac;

        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic get')) {
                t.end();
                return;
            }

            var obj = JSON.parse(stdout);
            t.equal(obj.mac, NIC.mac, 'nic MAC is correct');
            t.equal(obj.ip, NIC.ip, 'nic IP is correct');
            t.equal(obj.network, NIC.network, 'nic network is correct');

            t.end();
        });
    });

    suite.test('  triton instance nic list', function (t) {
        var cmd = 'instance nic list ' + INST;

        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic list')) {
                t.end();
                return;
            }

            var nics = stdout.trim().split('\n');
            t.ok(nics[0].match(/IP\s+MAC\s+STATE\s+NETWORK/), 'nic list' +
                ' header correct');
            nics.shift();

            t.ok(nics.length >= 1, 'triton nic list expected nic num');

            var testNics = nics.filter(function doFilter(nic) {
                return nic.match(NIC.mac);
            });

            t.equal(testNics.length, 1, 'triton nic list test nic found');

            t.end();
        });
    });

    suite.test('  triton instance nic list -j', function (t) {
        var cmd = 'instance nic list -j ' + INST;

        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic list')) {
                t.end();
                return;
            }

            var nics = stdout.trim().split('\n').map(function doParse(line) {
                return JSON.parse(line);
            });

            t.ok(nics.length >= 1, 'triton nic list expected nic num');

            var testNics = nics.filter(function doFilter(nic) {
                return nic.mac === NIC.mac;
            });

            t.equal(testNics.length, 1, 'triton nic list test nic found');

            t.end();
        });
    });

    suite.test(' triton instance nic list mac=<...>', function (t) {
        var cmd = 'instance nic list -j ' + INST + ' mac=' + NIC.mac;
        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err)) {
                t.end();
                return;
            }

            var nics = stdout.trim().split('\n').map(function doParse(str) {
                return JSON.parse(str);
            });

            t.equal(nics.length, 1);
            t.equal(nics[0].ip, NIC.ip);
            t.equal(nics[0].network, NIC.network);

            t.end();
        });
    });

    suite.test(' triton nic list mac=<...>', function (t) {
        var cmd = 'instance nic list -j ' + INST + ' mac=' + NIC.mac;

        h.triton(cmd, function doTriton(err, stdout, stderr) {
            if (h.ifErr(t, err)) {
                t.end();
                return;
            }

            var nics = stdout.trim().split('\n').map(function doParse(str) {
                return JSON.parse(str);
            });

            t.equal(nics.length, 1);
            t.equal(nics[0].ip, NIC.ip);
            t.equal(nics[0].network, NIC.network);

            t.end();
        });
    });

    suite.test('  triton instance nic delete', function (t) {
        var cmd = 'instance nic delete --force ' + INST + ' ' + NIC.mac;

        h.triton(cmd, function doTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic delete')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Deleted NIC ' + NIC.mac, 'deleted nic'));

            t.end();
        });
    });

    suite.test('  triton instance nic create (with NICOPTS)', function (t) {
        var cmd = 'instance nic create -j -w ' + INST + ' ipv4_uuid=' +
            NETWORK.id;

        h.triton(cmd, function doTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic create')) {
                t.end();
                return;
            }

            NIC2 = JSON.parse(stdout);

            t.end();
        });
    });

    suite.test('  triton instance nic with ip get', function (t) {
        var cmd = 'instance nic get ' + INST + ' ' + NIC2.mac;

        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic get')) {
                t.end();
                return;
            }

            var obj = JSON.parse(stdout);
            t.equal(obj.mac, NIC2.mac, 'nic MAC is correct');
            t.equal(obj.ip, NIC2.ip, 'nic IP is correct');
            t.equal(obj.network, NIC2.network, 'nic network is correct');

            t.end();
        });
    });

    suite.test('  triton instance nic with ip delete', function (t) {
        var cmd = 'instance nic delete --force ' + INST + ' ' + NIC2.mac;

        h.triton(cmd, function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic with ip delete')) {
                t.end();
                return;
            }

            t.ok(stdout.match('Deleted NIC ' + NIC2.mac, 'deleted nic'));

            t.end();
        });
    });

    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    suite.test('  cleanup: triton instance rm INST', {timeout: 10 * 60 * 1000},
            function (t) {
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });

    suite.end();
});
