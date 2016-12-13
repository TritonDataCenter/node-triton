/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

/*
 * Integration tests for using network-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');


// --- Globals

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

    tt.test(' setup: net', function (t) {
        var opts = {
            account: CLIENT.profile.account
        };
        CLIENT.cloudapi.listNetworks(opts, function (err, nets) {
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


    tt.test(' teardown: client', function (t) {
        CLIENT.close();
        t.end();
    });
});
