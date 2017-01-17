/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Integration tests for `triton network(s)`
 */

var h = require('./helpers');
var test = require('tape');

var common = require('../../lib/common');


// --- Globals

var networks;


// --- Tests

test('triton networks', function (tt) {

    tt.test(' triton network list -h', function (t) {
        h.triton('networks -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network list/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton help networks', function (t) {
        h.triton('help networks', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            // JSSTYLED
            t.ok(/shortcut for "triton network list"/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton networks', function (t) {
        h.triton('networks', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^SHORTID\b/.test(stdout));
            t.ok(/\bFABRIC\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton network list', function (t) {
        h.triton('network list', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^SHORTID\b/.test(stdout));
            t.ok(/\bFABRIC\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton networks public=false', function (t) {
        h.triton('networks public=false -H -o public',
        function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var results = stdout.trim().split('\n');
            results.forEach(function (result) {
                t.equal(false, common.boolFromString(result, null, 'public'));
            });
            t.end();
        });
    });

    tt.test(' triton network list public=false', function (t) {
        h.triton('network list public=false -H -o public',
        function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var results = stdout.trim().split('\n');
            results.forEach(function (result) {
                t.equal(false, common.boolFromString(result, null, 'public'));
            });
            t.end();
        });
    });

    tt.test(' triton network list public=true', function (t) {
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

    tt.test(' triton network list public=bogus', function (t) {
        h.triton('network list public=bogus', function (err, stdout, stderr) {
            t.ok(err, err);
            t.end();
        });
    });

    tt.test(' triton networks -l', function (t) {
        h.triton('networks -l', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^ID\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton networks -j', function (t) {
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

});


test('triton network get', function (tt) {

    tt.test(' triton network get -h', function (t) {
        h.triton('network get -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton network help get', function (t) {
        h.triton('network help get', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network get\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton network get', function (t) {
        h.triton('network get', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    tt.test(' triton network get ID', function (t) {
        h.triton('network get ' + networks[0].id,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    tt.test(' triton network get SHORTID', function (t) {
        var shortid = networks[0].id.split('-')[0];
        h.triton('network get ' + shortid, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    tt.test(' triton network get NAME', function (t) {
        h.triton('network get ' + networks[0].name,
                function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

});
