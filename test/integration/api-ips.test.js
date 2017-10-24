/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

/*
 * Integration tests for using ip-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');


// --- Globals

var CLIENT;
var NET;
var IP;


// --- Tests

test('TritonApi network ips', function (tt) {
    tt.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });

    tt.test(' setup: net', function (t) {
        var opts = {
            account: CLIENT.profile.account
        };
        CLIENT.cloudapi.listNetworks(opts, function (err, nets) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(Array.isArray(nets), 'networks');

            // Array.find() is only in newer node versions
            while (nets.length > 0) {
                var elm = nets.shift();
                if (elm.fabric === true) {
                    NET = elm;
                    break;
                }
            }
            t.ok(NET, 'fabric network required');

            t.end();
        });
    });

    tt.test(' TritonApi listIps', function (t) {
        if (!NET) {
            return t.end();
        }

        CLIENT.listNetworkIps(NET.id, function (err, ips) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(Array.isArray(ips), 'ips');

            IP = ips[0];

            t.end();
        });
    });


    tt.test(' TritonApi getIp', function (t) {
        if (!NET || !IP) {
            return t.end();
        }

        var opts = {
            id: NET.id,
            ip: IP.ip
        };

        CLIENT.getNetworkIp(opts, function (err, ip) {
            if (h.ifErr(t, err, 'no err'))
                return t.end();

            t.deepEqual(ip, IP, 'ip');

            t.end();
        });
    });


    tt.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });
});
