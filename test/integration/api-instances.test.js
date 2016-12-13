/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

/*
 * Integration tests for using instance-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');


// --- Globals

var CLIENT;
var INST;


// --- Tests

test('TritonApi packages', function (tt) {

    tt.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });

    tt.test(' setup: inst', function (t) {
        CLIENT.cloudapi.listMachines(function (err, insts) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(Array.isArray(insts), 'instances');

            INST = insts[0];

            t.end();
        });
    });


    tt.test(' TritonApi getInstance', function (t) {
        if (!INST) {
            return t.end();
        }

        function check(val, valName, next) {
            CLIENT.getInstance(val, function (err, inst) {
                if (h.ifErr(t, err, 'no err'))
                    return t.end();

                /*
                 * Normalize: There can be fields that are on the machine object
                 * for CloudAPI GetMachine, but not for ListMachine:
                 * - dns_names (if CNS is enabled in the DC)
                 */
                delete inst.dns_names;
                t.deepEqual(inst, INST, valName);

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


    tt.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });
});
