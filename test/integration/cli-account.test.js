/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for `triton account`
 */

var h = require('./helpers');
var test = require('tape');



// --- Globals



// --- Tests

test('triton account', function (tt) {

    tt.test(' triton account -h', function (t) {
        h.triton('account -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton account/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton help account', function (t) {
        h.triton('help account', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton account/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton account', function (t) {
        h.triton('account', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(new RegExp('^login: ' + h.CONFIG.account, 'm').test(stdout));
            t.end();
        });
    });

    tt.test(' triton account -j', function (t) {
        h.triton('account -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            var account = JSON.parse(stdout);
            t.equal(account.login, h.CONFIG.account, 'account.login');
            t.end();
        });
    });

});
