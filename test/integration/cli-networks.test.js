/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Integration tests for `triton network(s)`
 */

var f = require('util').format;
var os = require('os');
var test = require('tap').test;
var h = require('./helpers');

var common = require('../../lib/common');


// --- Globals

var NET_NAME = f('nodetritontest-network-%s', os.hostname());

var networks;
var vlan;


// --- Tests

test('triton networks', function (suite) {

    suite.test('  setup: find a test VLAN', function (t) {
        h.triton('vlan list -j', function onTriton(err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            vlan = JSON.parse(stdout.trim().split('\n')[0]);
            t.ok(vlan, 'vlan for testing found');
            t.end();
        });
    });

    suite.test(' triton network list -h', function (t) {
        h.triton('networks -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network list/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton help networks', function (t) {
        h.triton('help networks', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            // JSSTYLED
            t.ok(/shortcut for "triton network list"/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton networks', function (t) {
        h.triton('networks', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^SHORTID\b/.test(stdout));
            t.ok(/\bFABRIC\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network list', function (t) {
        h.triton('network list', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^SHORTID\b/.test(stdout));
            t.ok(/\bFABRIC\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton networks public=false', function (t) {
        h.triton('networks public=false -H -o public',
        function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            if (stdout.trim()) {
                var results = stdout.trim().split('\n');
                results.forEach(function (result) {
                    t.equal(false,
                        common.boolFromString(result, null, 'public'));
                });
            }
            t.end();
        });
    });

    suite.test(' triton network list public=false', function (t) {
        h.triton('network list public=false -H -o public',
        function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            if (stdout.trim()) {
                var results = stdout.trim().split('\n');
                results.forEach(function (result) {
                    t.equal(false,
                        common.boolFromString(result, null, 'public'));
                });
            }
            t.end();
        });
    });

    suite.test(' triton network list public=true', function (t) {
        h.triton('network list public=true -H -o public',
        function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var results = stdout.trim().split('\n');
            results.forEach(function (result) {
                t.equal(true, common.boolFromString(result, null, 'public'));
            });
            t.end();
        });
    });

    suite.test(' triton network list public=bogus', function (t) {
        h.triton('network list public=bogus', function (err, stdout, stderr) {
            t.ok(err, err);
            t.end();
        });
    });

    suite.test(' triton networks -l', function (t) {
        h.triton('networks -l', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^ID\b/.test(stdout));
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
                networks.push(JSON.parse(line));
            });
            t.ok(networks.length > 0, 'have at least one network');
            t.ok(common.isUUID(networks[0].id));
            t.end();
        });
    });

    suite.end();
});


test('triton network get', function (suite) {

    suite.test(' triton network get -h', function (t) {
        h.triton('network get -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network help get', function (t) {
        h.triton('network help get', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network get\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network get', function (t) {
        h.triton('network get', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    suite.test(' triton network get ID', function (t) {
        h.triton('network get ' + networks[0].id,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    suite.test(' triton network get SHORTID', function (t) {
        var shortid = networks[0].id.split('-')[0];
        h.triton('network get ' + shortid, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    suite.test(' triton network get NAME', function (t) {
        h.triton('network get ' + networks[0].name,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    suite.end();
});


test('triton network create', {
    skip: !h.CONFIG.allowWriteActions && 'requires config.allowWriteActions'
}, function (suite) {

    suite.test('  cleanup: rm network ' + NET_NAME + ' if exists',
    function (t) {
        h.triton('network delete ' + NET_NAME, function (err, stdout) {
            t.end();
        });
    });

    suite.test(' triton network create -h', function (t) {
        h.triton('network create -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network help create', function (t) {
        h.triton('network help create', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network create\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network create', function (t) {
        h.triton('network create', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    suite.test(' triton network create VLAN', {
        skip: !process.env.TEST_KNOWN_FAIL && 'known failure, see TRITON-1389'
    }, function (t) {
        h.triton('network create --name=' + NET_NAME +
                 ' --subnet=192.168.97.0/24 --start_ip=192.168.97.1' +
                 ' --end_ip=192.168.97.254 -j ' + vlan.vlan_id,
                 function (err, stdout) {
            if (h.ifErr(t, err))
                return t.end();

            var network = JSON.parse(stdout.trim().split('\n')[0]);

            t.equal(network.name, NET_NAME);
            t.equal(network.subnet, '192.168.97.0/24');
            t.equal(network.provision_start_ip, '192.168.97.1');
            t.equal(network.provision_end_ip, '192.168.97.254');
            t.equal(network.vlan_id, vlan.vlan_id);

            h.triton('network delete ' + network.id, function (err2) {
                h.ifErr(t, err2);
                t.end();
            });
        });
    });

    suite.end();
});


test('triton network delete', {
    skip: (
        (!process.env.TEST_KNOWN_FAIL && 'known failure, see TRITON-1389') ||
        (!h.CONFIG.allowWriteActions && 'requires config.allowWriteActions')
    )
}, function (suite) {

    suite.test(' triton network delete -h', function (t) {
        h.triton('network delete -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network help delete', function (t) {
        h.triton('network help delete', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network delete\b/.test(stdout));
            t.end();
        });
    });

    suite.test(' triton network delete', function (t) {
        h.triton('network delete', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    function deleteNetworkTester(t, deleter) {
        h.triton('network create --name=' + NET_NAME +
                 ' --subnet=192.168.97.0/24 --start_ip=192.168.97.1' +
                 ' --end_ip=192.168.97.254 -j ' + vlan.vlan_id,
                 function (err, stdout) {
            if (h.ifErr(t, err, 'create test network'))
                return t.end();

            var network = JSON.parse(stdout.trim().split('\n')[0]);

            deleter(null, network, function (err2) {
                if (h.ifErr(t, err2, 'deleting test network'))
                    return t.end();

                h.triton('network get ' + network.id, function (err3) {
                    t.ok(err3, 'network should be gone');
                    t.end();
                });
            });
        });
    }

    suite.test(' triton network delete ID', function (t) {
        deleteNetworkTester(t, function (err, network, cb) {
            h.triton('network delete ' + network.id, cb);
        });
    });

    suite.test(' triton network delete NAME', function (t) {
        deleteNetworkTester(t, function (err, network, cb) {
            h.triton('network delete ' + network.name, cb);
        });
    });

    suite.test(' triton network delete SHORTID', function (t) {
        deleteNetworkTester(t, function (err, network, cb) {
            var shortid = network.id.split('-')[0];
            h.triton('network delete ' + shortid, cb);
        });
    });

    suite.end();
});
