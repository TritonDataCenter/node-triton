/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Integration tests for `triton vlans`
 */

var f = require('util').format;
var os = require('os');
var test = require('tape');
var h = require('./helpers');

var common = require('../../lib/common');


// --- Globals

var VLAN_NAME = f('nodetritontest-vlan-%s', os.hostname());
var VLAN_ID   = 3197;

var VLAN;

var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};


// --- Tests

if (OPTS.skip) {
    console.error('** skipping some %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton vlan list', function (tt) {

    tt.test(' triton vlan list -h', function (t) {
        h.triton('vlan list -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan list/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan list', function (t) {
        h.triton('vlan list', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/^VLAN_ID\b/.test(stdout));
            t.ok(/\bNAME\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan list -j', function (t) {
        h.triton('vlan list -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            VLAN = JSON.parse(stdout.trim().split('\n')[0]);

            t.end();
        });
    });

    tt.test(' triton vlan list vlan_id=<...>', function (t) {
        var cmd = 'vlan list -j vlan_id=' + VLAN.vlan_id;
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var vlans = stdout.trim().split('\n').map(function (str) {
                return JSON.parse(str);
            });

            t.deepEqual(vlans, [VLAN]);

            t.end();
        });
    });

    tt.test(' triton vlan list vlan_id=<...> name=<...> (good)', function (t) {
        var cmd = 'vlan list -j vlan_id=' + VLAN.vlan_id + ' name=' + VLAN.name;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var vlans = stdout.trim().split('\n').map(function (str) {
                return JSON.parse(str);
            });

            t.deepEqual(vlans, [VLAN]);

            t.end();
        });
    });

    tt.test(' triton vlan list vlan_id=<...> name=<...> (bad)', function (t) {
        // search for a mismatch, should return nada
        var cmd = 'vlan list -j vlan_id=' + VLAN.vlan_id + ' name=' +
                  VLAN.name + 'a';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.equal(stdout, '');

            t.end();
        });
    });

});


test('triton vlan get', function (tt) {

    tt.test(' triton vlan get -h', function (t) {
        h.triton('vlan get -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan help get', function (t) {
        h.triton('vlan help get', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan get\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan get', function (t) {
        h.triton('vlan get', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    tt.test(' triton vlan get ID', function (t) {
        h.triton('vlan get ' + VLAN.vlan_id,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var vlan = JSON.parse(stdout);
            t.equal(vlan.vlan_id, VLAN.vlan_id);

            t.end();
        });
    });

    tt.test(' triton vlan get NAME', function (t) {
        h.triton('vlan get ' + VLAN.name,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var vlan = JSON.parse(stdout);
            t.equal(vlan.vlan_id, VLAN.vlan_id);

            t.end();
        });
    });

});


test('triton vlan networks', function (tt) {

    tt.test(' triton vlan networks -h', function (t) {
        h.triton('vlan networks -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan networks/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan help networks', function (t) {
        h.triton('vlan help networks', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan networks/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan networks', function (t) {
        h.triton('vlan networks', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    tt.test(' triton vlan networks ID', function (t) {
        h.triton('vlan networks -j ' + VLAN.vlan_id,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var vlan = JSON.parse(stdout);
            t.equal(vlan.vlan_id, VLAN.vlan_id);

            t.end();
        });
    });

    tt.test(' triton vlan networks NAME', function (t) {
        h.triton('vlan networks -j ' + VLAN.name,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            var vlan = JSON.parse(stdout);
            t.equal(vlan.vlan_id, VLAN.vlan_id);

            t.end();
        });
    });

});


test('triton vlan create', OPTS, function (tt) {

    tt.test('  cleanup: rm vlan ' + VLAN_NAME + ' if exists', function (t) {
        h.triton('vlan delete ' + VLAN_NAME, function (err, stdout) {
            t.end();
        });
    });

    tt.test(' triton vlan create -h', function (t) {
        h.triton('vlan create -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan help create', function (t) {
        h.triton('vlan help create', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan create\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan create', function (t) {
        h.triton('vlan create', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));

            t.end();
        });
    });

    tt.test(' triton vlan create VLAN', function (t) {
        h.triton('vlan create -j --name=' + VLAN_NAME + ' ' + VLAN_ID,
                 function (err, stdout) {
            if (h.ifErr(t, err))
                return t.end();

            var vlan = JSON.parse(stdout.trim().split('\n')[0]);

            t.equal(vlan.name, VLAN_NAME);
            t.equal(vlan.vlan_id, VLAN_ID);

            h.triton('vlan delete ' + vlan.vlan_id, function (err2) {
                h.ifErr(t, err2);
                t.end();
            });
        });
    });

});


test('triton vlan delete', OPTS, function (tt) {

    tt.test(' triton vlan delete -h', function (t) {
        h.triton('vlan delete -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan help delete', function (t) {
        h.triton('vlan help delete', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(/Usage:\s+triton vlan delete\b/.test(stdout));

            t.end();
        });
    });

    tt.test(' triton vlan delete', function (t) {
        h.triton('vlan delete', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));

            t.end();
        });
    });

    function deleteNetworkTester(t, deleter) {
        h.triton('vlan create -j --name=' + VLAN_NAME + ' ' + VLAN_ID,
                 function (err, stdout) {
            if (h.ifErr(t, err, 'create test vlan'))
                return t.end();

            var vlan = JSON.parse(stdout.trim().split('\n')[0]);

            deleter(null, vlan, function (err2) {
                if (h.ifErr(t, err2, 'deleting test vlan'))
                    return t.end();

                h.triton('vlan get ' + vlan.vlan_id, function (err3) {
                    t.ok(err3, 'vlan should be gone');
                    t.end();
                });
            });
        });
    }

    tt.test(' triton vlan delete ID', function (t) {
        deleteNetworkTester(t, function (err, vlan, cb) {
            h.triton('vlan delete ' + vlan.vlan_id, cb);
        });
    });

    tt.test(' triton vlan delete NAME', function (t) {
        deleteNetworkTester(t, function (err, vlan, cb) {
            h.triton('vlan delete ' + vlan.name, cb);
        });
    });

});
