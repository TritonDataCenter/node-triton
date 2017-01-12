/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for `triton ...` CLI basics.
 */

var h = require('./helpers');
var test = require('tape');



// --- Globals



// --- Tests

test('triton (basics)', function (tt) {

    tt.test(' triton --version', function (t) {
        h.triton('--version', function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton --version'))
                return t.end();
            t.ok(/^Triton CLI \d+\.\d+\.\d+/.test(stdout),
                'version on first line');
            t.ok(/^https:/m.test(stdout), 'project link in version output');
            t.end();
        });
    });

    tt.test(' triton -h', function (t) {
        h.triton('-h', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^Usage:$/m.test(stdout));
            t.ok(/triton help COMMAND/.test(stdout));
            t.ok(/instance/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton --help', function (t) {
        h.triton('--help', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^Usage:$/m.test(stdout));
            t.ok(/triton help COMMAND/.test(stdout));
            t.ok(/instance/.test(stdout));
            t.end();
        });
    });

    tt.test(' triton help', function (t) {
        h.triton('help', function (err, stdout, stderr) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(/^Usage:$/m.test(stdout));
            t.ok(/triton help COMMAND/.test(stdout));
            t.ok(/instance/.test(stdout));
            t.end();
        });
    });

});
