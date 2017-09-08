/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Integration tests for using NIC-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');


// --- Globals

var CLIENT;
var INST;
var NIC;


// --- Tests

test('TritonApi networks', function (tt) {
    tt.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });


    tt.test(' setup: inst', function (t) {
        CLIENT.cloudapi.listMachines({}, function (err, vms) {
            if (vms.length === 0)
                return t.end();

            t.ok(Array.isArray(vms), 'vms array');
            INST = vms[0];

            t.end();
        });
    });


    tt.test(' TritonApi listNics', function (t) {
        if (!INST)
            return t.end();

        function check(val, valName, next) {
            CLIENT.listNics({id: val}, function (err, nics) {
                if (h.ifErr(t, err, 'no err ' + valName))
                    return t.end();

                t.ok(Array.isArray(nics), 'nics array');
                NIC = nics[0];

                next();
            });
        }

        var shortId = INST.id.split('-')[0];

        check(INST.id, 'id', function () {
            check(INST.name, 'name', function () {
                check(shortId, 'shortId', function () {
                    t.end();
                });
            });
        });
    });


    tt.test(' TritonApi getNic', function (t) {
        if (!NIC)
            return t.end();

        function check(inst, mac, instValName, next) {
            CLIENT.getNic({id: inst, mac: mac}, function (err, nic) {
                if (h.ifErr(t, err, 'no err for ' + instValName))
                    return t.end();

                t.deepEqual(nic, NIC, instValName);

                next();
            });
        }

        var shortId = INST.id.split('-')[0];

        check(INST.id, NIC.mac, 'id', function () {
            check(INST.name, NIC.mac, 'name', function () {
                check(shortId, NIC.mac, 'shortId', function () {
                    t.end();
                });
            });
        });
    });


    tt.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });
});
