/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test subcommands existence and usage
 */

var f = require('util').format;

var h = require('./helpers');
var test = require('tape');

var common = require('../../lib/common');

var subs = [
    ['info'],
    ['profile'],
    ['profiles'],
    ['account', 'whoami'],
    ['keys'],
    ['services'],
    ['datacenters'],
    ['create-instance', 'create'],
    ['instances', 'insts'],
    ['instance', 'inst'],
    ['instance-audit', 'audit'],
    ['start-instance', 'start'],
    ['stop-instance', 'stop'],
    ['reboot-instance', 'reboot'],
    ['delete-instance', 'delete'],
    ['wait-instance', 'wait'],
    ['ssh'],
    ['images', 'imgs'],
    ['image', 'img'],
    ['packages', 'pkgs'],
    ['package', 'pkg'],
    ['networks'],
    ['network']
];

// --- Tests

test('triton subcommands', function (ttt) {

    // loop each sub command group
    subs.forEach(function (subcmds) {
        ttt.test(f('  [%s]', subcmds), function (tt) {
            var out = [];

            // loop each individual subcommand to test
            // triton help <subcmd>
            // triton <subcmd> -h
            subcmds.forEach(function (subcmd) {
                tt.test(f('    triton help %s', subcmd), function (t) {
                    h.triton(['help', subcmd], function (err, stdout, stderr) {
                        if (h.ifErr(t, err, 'no error'))
                            return t.end();
                        t.equal(stderr, '', 'stderr produced');
                        t.notEqual(stdout, '', 'stdout empty');
                        out.push(stdout);
                        t.end();
                    });
                });

                tt.test(f('    triton %s -h', subcmd), function (t) {
                    h.triton([subcmd, '-h'], function (err, stdout, stderr) {
                        if (h.ifErr(t, err, 'no error'))
                            return t.end();
                        t.equal(stderr, '', 'stderr produced');
                        t.notEqual(stdout, '', 'stdout empty');
                        out.push(stdout);
                        t.end();
                    });
                });
            });

            // ensure all stdout output is the same
            out.forEach(function (stdout) {
                tt.equal(stdout, out[0], 'stdout mismatch');
            });
            tt.end();
        });
    });

    ttt.end();
});
