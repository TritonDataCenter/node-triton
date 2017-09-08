/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Integration tests for using network-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');


// --- Globals

var NET_NAME = 'node-triton-testnet967';

var CLIENT;
var NET;


// --- Tests

test('TritonApi networks', function (tt) {
    tt.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });

    tt.test('  cleanup: rm network ' + NET_NAME + ' if exists', function (t) {
        CLIENT.deleteFabricNetwork({id: NET_NAME}, function () {
            t.end();
        });
    });

    tt.test(' setup: net', function (t) {
        CLIENT.cloudapi.listNetworks({}, function (err, nets) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(Array.isArray(nets), 'networks');

            NET = nets[0];

            t.end();
        });
    });


    tt.test(' TritonApi getNetwork', function (t) {
        if (!NET) {
            return t.end();
        }

        function check(val, valName, next) {
            CLIENT.getNetwork(val, function (err, net) {
                if (h.ifErr(t, err, 'no err'))
                    return t.end();

                t.deepEqual(net, NET, valName);

                next();
            });
        }

        var shortId = NET.id.split('-')[0];

        check(NET.id, 'id', function () {
            check(NET.name, 'name', function () {
                check(shortId, 'shortId', function () {
                    t.end();
                });
            });
        });
    });


    tt.test(' TritonApi deleteFabricNetwork', function (t) {
        function check(genId, idType, vlanId, cb) {
            CLIENT.cloudapi.createFabricNetwork({
                name: NET_NAME,
                subnet: '192.168.97.0/24',
                provision_start_ip: '192.168.97.1',
                provision_end_ip: '192.168.97.254',
                vlan_id: vlanId
            }, function (err, net) {
                if (h.ifErr(t, err, 'Error creating network'))
                    return t.end();

                var id = genId(net);
                CLIENT.deleteFabricNetwork({id: id}, function (err2) {
                    if (h.ifErr(t, err, 'Error deleting network by ' + idType))
                        return t.end();

                    CLIENT.cloudapi.getNetwork(net.id, function (err3) {
                        t.ok(err3, 'Network should be gone');
                        cb();
                    });
                });
            });
        }

        CLIENT.cloudapi.listFabricVlans({}, function (err, vlans) {
            if (vlans.length === 0)
                return t.end();

            var vlanId = +vlans[0].vlan_id;

            check(function (net) { return net.id; }, 'id', vlanId, function () {
                check(function (net) { return net.name; }, 'name', vlanId,
                      function () {
                    check(function (net) { return net.id.split('-')[0]; },
                          'shortId', vlanId, function () {
                        t.end();
                    });
                });
            });
        });
    });



    tt.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });
});
