/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
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

    tt.test(' triton networks -h', function (t) {
        h.triton('networks -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton networks/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton help networks', function (t) {
        h.triton('help networks', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton networks/.test(stdout));
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


test('triton network', function (tt) {

    tt.test(' triton network -h', function (t) {
        h.triton('network -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton help network', function (t) {
        h.triton('help network', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton network\b/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton network', function (t) {
        h.triton('network', function (err, stdout, stderr) {
            t.ok(err);
            t.ok(/error \(Usage\)/.test(stderr));
            t.end();
        });
    });

    tt.test(' triton network ID', function (t) {
        h.triton('network ' + networks[0].id, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    tt.test(' triton network SHORTID', function (t) {
        var shortid = networks[0].id.split('-')[0];
        h.triton('network ' + shortid, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

    tt.test(' triton network NAME', function (t) {
        h.triton('network ' + networks[0].name, function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var network = JSON.parse(stdout);
            t.equal(network.id, networks[0].id);
            t.end();
        });
    });

});
