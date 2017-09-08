/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Integration tests for `triton instance nics ...`
 */

var h = require('./helpers');
var f = require('util').format;
var os = require('os');
var test = require('tape');

// --- Globals

var INST_ALIAS = f('nodetritontest-nics-%s', os.hostname());
var NETWORK;
var INST;
var NIC;

var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};


// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton instance nics', OPTS, function (tt) {
    h.printConfig(tt);

    tt.test('  cleanup existing inst with alias ' + INST_ALIAS, function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    tt.test('  setup: triton instance create', function (t) {
        h.createTestInst(t, INST_ALIAS, function onInst(err, instId) {
            if (h.ifErr(t, err, 'triton instance create'))
                return t.end();

            INST = instId;

            t.end();
        });
    });

    tt.test('  setup: find network for tests', function (t) {
        h.triton('network list -j', function onNetworks(err, stdout) {
            if (h.ifErr(t, err, 'triton network list'))
                return t.end();

            NETWORK = JSON.parse(stdout.trim().split('\n')[0]);

            t.end();
        });
    });

    tt.test('  triton instance nic create', function (t) {
        var cmd = 'instance nic create -j -w ' + INST + ' ' + NETWORK.id;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic create'))
                return t.end();

            NIC = JSON.parse(stdout);

            t.end();
        });
    });

    tt.test('  triton instance nic get', function (t) {
        var cmd = 'instance nic get ' + INST + ' ' + NIC.mac;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic get'))
                return t.end();

            var obj = JSON.parse(stdout);
            t.equal(obj.mac, NIC.mac, 'nic MAC is correct');
            t.equal(obj.ip, NIC.ip, 'nic IP is correct');
            t.equal(obj.network, NIC.network, 'nic network is correct');

            t.end();
        });
    });

    tt.test('  triton instance nic list', function (t) {
        var cmd = 'instance nic list ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic list'))
                return t.end();

            var nics = stdout.trim().split('\n');
            t.ok(nics[0].match(/IP\s+MAC\s+STATE\s+DEFAULT\s+NETWORK/));
            nics.shift();

            t.ok(nics.length >= 1, 'triton nic list expected nic num');

            var testNics = nics.filter(function (nic) {
                return nic.match(NIC.mac);
            });

            t.equal(testNics.length, 1, 'triton nic list test nic found');

            t.end();
        });
    });

    tt.test('  triton instance nic list -j', function (t) {
        var cmd = 'instance nic list -j ' + INST;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic list'))
                return t.end();

            var nics = stdout.trim().split('\n').map(function (line) {
                return JSON.parse(line);
            });

            t.ok(nics.length >= 1, 'triton nic list expected nic num');

            var testNics = nics.filter(function (nic) {
                return nic.mac === NIC.mac;
            });

            t.equal(testNics.length, 1, 'triton nic list test nic found');

            t.end();
        });
    });

    tt.test(' triton instance nic list mac=<...>', function (t) {
        var cmd = 'instance nic list -j ' + INST + ' mac=' + NIC.mac;
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var nics = stdout.trim().split('\n').map(function (str) {
                return JSON.parse(str);
            });

            t.equal(nics.length, 1);
            t.equal(nics[0].ip, NIC.ip);
            t.equal(nics[0].network, NIC.network);

            t.end();
        });
    });

    tt.test(' triton nic list mac=<...> default=<...> (good)', function (t) {
        var cmd = 'instance nic list -j ' + INST + ' mac=' + NIC.mac +
                  ' default=' + !!NIC.default;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var nics = stdout.trim().split('\n').map(function (str) {
                return JSON.parse(str);
            });

            t.equal(nics.length, 1);
            t.equal(nics[0].ip, NIC.ip);
            t.equal(nics[0].network, NIC.network);

            t.end();
        });
    });

    tt.test(' triton nic list mac=<...> default=<...> (bad)', function (t) {
        // search for a mismatch, should return nada
        var cmd = 'instance nic list -j ' + INST + ' mac=' + NIC.mac +
                  ' default=' + !NIC.default;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.equal(stdout, '');

            t.end();
        });
    });

    tt.test('  triton instance nic delete', function (t) {
        var cmd = 'instance nic delete --force ' + INST + ' ' + NIC.mac;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance nic delete'))
                return t.end();

            t.ok(stdout.match('Deleted NIC ' + NIC.mac, 'deleted nic'));

            t.end();
        });
    });

    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    tt.test('  cleanup: triton instance rm INST', {timeout: 10 * 60 * 1000},
            function (t) {
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });
});
