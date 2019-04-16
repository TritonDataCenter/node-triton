/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Integration tests for `triton network ip`
 */

var h = require('./helpers');
var test = require('tap').test;

var common = require('../../lib/common');


// --- Globals

var networks;
var ips;


// --- Tests

test('triton network ip list', function (suite) {

    suite.test(' triton network ip list -h', function (t) {
        h.triton('network ip list -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network ip list NETWORK/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton networks -j', function (t) {
        h.triton('networks -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            networks = [];
            stdout.split('\n').forEach(function (line) {
                if (!line.trim()) {
                    return;
                }
                var net = JSON.parse(line);
                if (net.fabric === true) {
                    networks.push(net);
                }
            });
            t.ok(networks.length > 0, 'have at least one fabric network');
            t.ok(common.isUUID(networks[0].id));
            t.end();
        });
    });

    suite.test(' triton network ip list', function (t) {
        h.triton('network ip list', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    suite.test(' triton network ip list ID', function (t) {
        h.triton('network ip list ' + networks[0].id,
            function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^IP\b/.test(stdout));
            t.ok(/\bMANAGED\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network ip list SHORTID', function (t) {
        var shortid = networks[0].id.split('-')[0];
        h.triton('network ip list ' + shortid, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^IP\b/.test(stdout));
            t.ok(/\bMANAGED\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network ip list -j', function (t) {
        h.triton('network ip list -j ' + networks[0].id,
            function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            ips = [];
            stdout.split('\n').forEach(function (line) {
                if (!line.trim()) {
                    return;
                }
                ips.push(JSON.parse(line));
            });
            t.ok(ips.length > 0, 'have at least one ip');
            t.ok(ips[0].ip, 'ip obj has an ip');
            t.end();
        });
    });

    suite.end();
});


test('triton network ip get', function (suite) {

    suite.test(' triton network ip get -h', function (t) {
        h.triton('network ip get -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network ip\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network ip help get', function (t) {
        h.triton('network ip help get', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network ip get\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network ip get', function (t) {
        h.triton('network ip get', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    suite.test(' triton network ip get ID IP', function (t) {
        h.triton('network ip get ' + networks[0].id + ' ' +
                ips[0].ip, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var ip = JSON.parse(stdout);
            t.equal(ip.ip, ips[0].ip);
            t.end();
        });
    });

    suite.test(' triton network ip get SHORTID IP', function (t) {
        var shortid = networks[0].id.split('-')[0];
        h.triton('network ip get ' + shortid + ' ' + ips[0].ip,
            function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var ip = JSON.parse(stdout);
            t.equal(ip.ip, ips[0].ip);
            t.end();
        });
    });

    suite.test(' triton network ip get NAME IP', function (t) {
        h.triton('network ip get ' + networks[0].name + ' ' +
                ips[0].ip, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var ip = JSON.parse(stdout);
            t.equal(ip.ip, ips[0].ip);
            t.end();
        });
    });

    suite.end();
});
