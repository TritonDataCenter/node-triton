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
    ['profile list', 'profile ls', 'profiles'],
    ['profile get'],
    ['profile set-current'],
    ['profile create'],
    ['profile edit'],
    ['profile delete', 'profile rm'],
    ['env'],
    ['completion'],
    ['account'],
    ['account get'],
    ['account update'],
    ['services'],
    ['datacenters'],
    ['instance', 'inst'],
    ['instance list', 'instance ls', 'instances', 'insts', 'ls'],
    ['instance get'],
    ['instance create', 'create'],
    ['instance start', 'start'],
    ['instance stop', 'stop'],
    ['instance reboot', 'reboot'],
    ['instance delete', 'instance rm', 'delete', 'rm'],
    ['instance enable-firewall'],
    ['instance disable-firewall'],
    ['instance rename'],
    ['instance ssh'],
    ['instance ip'],
    ['instance wait'],
    ['instance audit'],
    ['instance fwrules'],
    ['instance snapshot'],
    ['instance snapshot create'],
    ['instance snapshot list', 'instance snapshot ls', 'instance snapshots'],
    ['instance snapshot get'],
    ['instance snapshot delete', 'instance snapshot rm'],
    ['ip'],
    ['ssh'],
    ['network'],
    ['network list', 'networks'],
    ['network get'],
    ['key'],
    ['key add'],
    ['key list', 'key ls', 'keys'],
    ['key get'],
    ['key delete', 'key rm'],
    ['image', 'img'],
    ['image get'],
    ['image list', 'images', 'imgs'],
    ['package', 'pkg'],
    ['package get'],
    ['package list', 'packages', 'pkgs'],
    ['fwrules'],
    ['fwrule'],
    ['fwrule create'],
    ['fwrule list', 'fwrule ls'],
    ['fwrule get'],
    ['fwrule update'],
    ['fwrule delete', 'fwrule rm'],
    ['fwrule enable'],
    ['fwrule disable'],
    ['fwrule instances', 'fwrule insts'],
    ['rbac'],
    ['rbac info'],
    ['rbac apply'],
    ['rbac users'],
    ['rbac user'],
    ['rbac keys'],
    ['rbac key'],
    ['rbac policies'],
    ['rbac policy'],
    ['rbac roles'],
    ['rbac role'],
    ['rbac instance-role-tags'],
    ['rbac image-role-tags'],
    ['rbac network-role-tags'],
    ['rbac package-role-tags'],
    ['rbac role-tags']
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
                var helpArgs = subcmd.split(' ');
                helpArgs.splice(helpArgs.length - 1, 0, 'help');

                tt.test(f('    triton %s', helpArgs.join(' ')), function (t) {
                    h.triton(helpArgs, function (err, stdout, stderr) {
                        if (h.ifErr(t, err, 'no error'))
                            return t.end();
                        t.equal(stderr, '', 'stderr produced');
                        t.notEqual(stdout, '', 'stdout empty');
                        out.push(stdout);
                        t.end();
                    });
                });

                var flagArgs = subcmd.split(' ').concat('-h');

                tt.test(f('    triton %s', flagArgs.join(' ')), function (t) {
                    h.triton(flagArgs, function (err, stdout, stderr) {
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
