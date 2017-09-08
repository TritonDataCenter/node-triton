/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Integration tests for using VLAN-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');


// --- Globals

var CLIENT;
var VLAN;


// --- Tests

test('TritonApi networks', function (tt) {
    tt.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });


    tt.test(' setup: vlan', function (t) {
        CLIENT.cloudapi.listFabricVlans({}, function (err, vlans) {
            if (vlans.length === 0)
                return t.end();

            VLAN = vlans[0];

            t.end();
        });
    });


    tt.test(' TritonApi getFabricVlan', function (t) {
        if (!VLAN)
            return t.end();

        function check(val, valName, next) {
            CLIENT.getFabricVlan(val, function (err, vlan) {
                if (h.ifErr(t, err, 'no err'))
                    return t.end();

                t.deepEqual(vlan, VLAN, valName);

                next();
            });
        }

        check(VLAN.vlan_id, 'vlan_id', function () {
            check(VLAN.name, 'name', function () {
                t.end();
            });
        });
    });


    tt.test(' TritonApi deleteFabricVlan', function (t) {
        function check(genId, idType, cb) {
            CLIENT.cloudapi.createFabricVlan({
                vlan_id: 3291,
                name: 'test3291'
            }, function (err, vlan) {
                if (h.ifErr(t, err, 'Error creating VLAN'))
                    return t.end();

                var id = genId(vlan);
                CLIENT.deleteFabricVlan({vlan_id: id}, function (err2) {
                    if (h.ifErr(t, err, 'Error deleting VLAN by ' + idType))
                        return t.end();

                    CLIENT.cloudapi.getFabricVlan({vlan_id: vlan.vlan_id},
                            function (err3) {
                        t.ok(err3, 'VLAN should be gone');
                        cb();
                    });
                });
            });
        }

        check(function (net) { return net.vlan_id; }, 'vlan_id', function () {
            check(function (net) { return net.name; }, 'name', function () {
                t.end();
            });
        });
    });


    tt.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });
});
