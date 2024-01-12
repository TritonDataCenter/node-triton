/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 * Copyright 2023 MNX Cloud, Inc.
 */

/*
 * Integration tests for using network-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tap').test;


// --- Globals

var NET_NAME = 'node-triton-testnet967';

var CLIENT;
var NET;

var writeTestOpts = {
    skip: !h.CONFIG.allowWriteActions && 'requires config.allowWriteActions'
};

// --- Tests

test('TritonApi networks', function (suite) {
    suite.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });

    suite.test('  cleanup: rm network ' + NET_NAME + ' if exists',
    function (t) {
        CLIENT.deleteFabricNetwork({id: NET_NAME}, function () {
            t.end();
        });
    });

    suite.test(' setup: net', function (t) {
        CLIENT.cloudapi.listNetworks({}, function (err, nets) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(Array.isArray(nets), 'networks');

            NET = nets[0];

            t.end();
        });
    });


    suite.test(' TritonApi getNetwork', function (t) {
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


    suite.test(' TritonApi deleteFabricNetwork', writeTestOpts, function (t) {
        function check(genId, idType, vlanId, cb) {
            CLIENT.cloudapi.createFabricNetwork({
                name: NET_NAME,
                subnet: '192.168.97.0/24',
                provision_start_ip: '192.168.97.1',
                provision_end_ip: '192.168.97.254',
                vlan_id: vlanId
            }, function onCreate(err, net) {
                if (h.ifErr(t, err, 'Error creating network')) {
                    t.end();
                    return;
                }

                var id = genId(net);
                CLIENT.deleteFabricNetwork({id: id}, function onDelete(err2) {
                    if (h.ifErr(t, err, 'Error deleting net by ' + idType)) {
                        t.end();
                        return;
                    }

                    CLIENT.cloudapi.getNetwork(net.id, function onGet(err3) {
                        t.ok(err3, 'Network should be gone');
                        cb();
                    });
                });
            });
        }

        // get a VLAN, then create and delete a set of fabrics to check it's
        // possible to delete by id, shortId and name
        CLIENT.cloudapi.listFabricVlans({}, function onList(err, vlans) {
            if (vlans.length === 0) {
                t.end();
                return;
            }

            function getId(net) { return net.id; }
            function getName(net) { return net.name; }
            function getShort(net) { return net.id.split('-')[0]; }

            var vlanId = +vlans[0].vlan_id;

            check(getId, 'id', vlanId, function onId() {
                check(getName, 'name', vlanId, function onName() {
                    check(getShort, 'shortId', vlanId, function onShort() {
                        t.end();
                    });
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
