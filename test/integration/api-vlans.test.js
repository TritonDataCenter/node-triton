/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Integration tests for using VLAN-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tap').test;


// --- Globals

var CLIENT;
var VLAN;


// --- Tests

test('TritonApi vlan', function (suite) {
    suite.test(' setup', function (t) {
        h.createClient(function onCreate(err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });


    suite.test(' setup: vlan', function (t) {
        CLIENT.cloudapi.listFabricVlans({}, function onList(err, vlans) {
            if (vlans.length === 0) {
                t.end();
                return;
            }

            VLAN = vlans[0];

            t.end();
        });
    });


    suite.test(' TritonApi getFabricVlan', function (t) {
        if (!VLAN) {
            t.end();
            return;
        }

        function check(val, valName, next) {
            CLIENT.getFabricVlan(val, function onGet(err, vlan) {
                if (h.ifErr(t, err, 'no err')) {
                    t.end();
                    return;
                }

                t.deepEqual(vlan, VLAN, valName);

                next();
            });
        }

        check(VLAN.vlan_id, 'vlan_id', function onId() {
            check(VLAN.name, 'name', function onName() {
                t.end();
            });
        });
    });


    suite.test(' TritonApi deleteFabricVlan', function (t) {
        function check(genId, idType, cb) {
            CLIENT.cloudapi.createFabricVlan({
                vlan_id: 3291,
                name: 'test3291'
            }, function onCreate(err, vlan) {
                if (h.ifErr(t, err, 'Error creating VLAN')) {
                    t.end();
                    return;
                }

                var id = genId(vlan);
                CLIENT.deleteFabricVlan({vlan_id: id}, function onDel(err2) {
                    if (h.ifErr(t, err, 'Error deleting VLAN by ' + idType)) {
                        t.end();
                        return;
                    }

                    CLIENT.cloudapi.getFabricVlan({vlan_id: vlan.vlan_id},
                            function onGet(err3) {
                        t.ok(err3, 'VLAN should be gone');
                        cb();
                    });
                });
            });
        }

        function getVlanId(net) { return net.vlan_id; }
        function getName(net) { return net.name; }

        check(getVlanId, 'vlan_id', function onId() {
            check(getName, 'name', function onName() {
                t.end();
            });
        });
    });


    suite.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });

    suite.end();
});
