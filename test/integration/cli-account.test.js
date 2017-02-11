/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Integration tests for `triton account`
 */

var h = require('./helpers');
var format = require('util').format;
var test = require('tape');



// --- Globals

var writeTestOpts = {
    skip: !h.CONFIG.allowWriteActions
};


// --- Tests

test('triton account', function (tt) {

    tt.test(' triton account -h', function (t) {
        h.triton('account -h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton account/.test(stdout), 'account usage');
            t.end();
        });
    });

    tt.test(' triton help account', function (t) {
        h.triton('help account', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/Usage:\s+triton account/.test(stdout), 'account usage');
            t.end();
        });
    });

    tt.test(' triton account get', function (t) {
        h.triton('-v account get', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(new RegExp(
                '^login: ' + h.CONFIG.profile.account, 'm').test(stdout));
            t.end();
        });
    });

    var account;
    tt.test(' triton account get -j', function (t) {
        h.triton('account get -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            account = JSON.parse(stdout);
            t.equal(account.login, h.CONFIG.profile.account, 'account.login');
            t.end();
        });
    });

    tt.test(' triton account update foo=bar', writeTestOpts, function (t) {
        h.triton('account update foo=bar', function (err, stdout, stderr) {
            t.ok(err);
            t.end();
        });
    });

    tt.test(' triton account update companyName=foo', writeTestOpts,
            function (t) {
        h.triton('account update companyName=foo', function (err, _o, _e) {
            if (h.ifErr(t, err))
                return t.end();

            /*
             * Limitation: because x-dc replication, the update might not be
             * reflected in a get right away.
             * TODO: poll 'account get' until a timeout, or implement that
             * with 'triton account update -w' and use that.
             */
            //h.triton('account get -j', function (err2, stdout, stderr) {
            //    if (h.ifErr(t, err2))
            //        return t.end();
            //    var updatedAccount = JSON.parse(stdout);
            //    t.equal(updatedAccount.companyName, 'foo',
            //        '<updated account>.companyName');
            //    t.end();
            //});
            t.end();
        });
    });

    tt.test(' triton account update companyName=<oldvalue>', writeTestOpts,
            function (t) {
        h.triton(
            format('account update companyName=\'%s\'',
                account.companyName || ''),
            function (err, _o, _e) {
                if (h.ifErr(t, err))
                    return t.end();
                t.end();
            });
    });
});
