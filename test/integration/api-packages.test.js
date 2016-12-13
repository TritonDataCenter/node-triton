/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

/*
 * Integration tests for using package-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');

var common = require('../../lib/common');


// --- Globals


var CLIENT;
var PKG;


// --- Tests


test('TritonApi packages', function (tt) {
    tt.test(' setup', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            CLIENT = client_;
            t.end();
        });
    });

    tt.test(' setup: pkg', function (t) {
        CLIENT.cloudapi.listPackages(function (err, pkgs) {
            if (h.ifErr(t, err))
                return t.end();

            t.ok(Array.isArray(pkgs), 'packages');

            PKG = pkgs[0];

            t.end();
        });
    });


    tt.test(' TritonApi getPackage', function (t) {
        if (!PKG) {
            return t.end();
        }

        function check(val, valName, next) {
            CLIENT.getPackage(val, function (err, pkg) {
                if (h.ifErr(t, err, 'no err'))
                    return t.end();

                t.deepEqual(pkg, PKG, valName);

                next();
            });
        }

        var shortId = PKG.id.split('-')[0];

        check(PKG.id, 'id', function () {
            check(PKG.name, 'name', function () {
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
