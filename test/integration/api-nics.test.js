/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Integration tests for using NIC-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tap').test;


// --- Globals

var CLIENT;
var INST;
var NIC;


// --- Tests

test('TritonApi nics', function (suite) {
    suite.test(' setup', function (t) {
        h.createClient(function onCreate(err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });


    suite.test(' setup: inst', function (t) {
        CLIENT.cloudapi.listMachines({}, function onList(err, vms) {
            if (vms.length === 0) {
                t.end();
                return;
            }

            t.ok(Array.isArray(vms), 'vms array');
            INST = vms[0];

            t.end();
        });
    });


    suite.test(' TritonApi listNics', function (t) {
        if (!INST) {
            t.end();
            return;
        }

        function check(val, valName, next) {
            CLIENT.listNics({id: val}, function onList(err, nics) {
                if (h.ifErr(t, err, 'no err ' + valName)) {
                    t.end();
                    return;
                }

                t.ok(Array.isArray(nics), 'nics array');
                NIC = nics[0];

                next();
            });
        }

        var shortId = INST.id.split('-')[0];

        check(INST.id, 'id', function doId() {
            check(INST.name, 'name', function doName() {
                check(shortId, 'shortId', function doShort() {
                    t.end();
                });
            });
        });
    });


    suite.test(' TritonApi getNic', function (t) {
        if (!NIC) {
            t.end();
            return;
        }

        function check(inst, mac, instValName, next) {
            CLIENT.getNic({id: inst, mac: mac}, function onGet(err, nic) {
                if (h.ifErr(t, err, 'no err for ' + instValName)) {
                    t.end();
                    return;
                }

                t.deepEqual(nic, NIC, instValName);

                next();
            });
        }

        var shortId = INST.id.split('-')[0];

        check(INST.id, NIC.mac, 'id', function doId() {
            check(INST.name, NIC.mac, 'name', function doName() {
                check(shortId, NIC.mac, 'shortId', function doShort() {
                    t.end();
                });
            });
        });
    });


    suite.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });

    suite.end();
});
