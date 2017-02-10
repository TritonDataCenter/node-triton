/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Test subcommands existence and usage
 */

var f = require('util').format;

var h = require('./helpers');
var test = require('tap').test;

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
    ['instance enable-deletion-protection'],
    ['instance disable-deletion-protection'],
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
    ['instance nic create'],
    ['instance nic list', 'instance nic ls'],
    ['instance nic get'],
    ['instance nic delete', 'instance nic rm'],
    ['instance disk'],
    ['instance disk add'],
    ['instance disk list', 'instance disk ls'],
    ['instance disk get'],
    ['instance disk resize'],
    ['instance disk delete', 'instance disk rm'],
    ['instance migration begin'],
    ['instance migration switch'],
    ['instance migration sync'],
    ['instance migration pause'],
    ['instance migration abort'],
    ['instance migration get'],
    ['instance migration list'],
    ['instance migration automatic'],
    ['instance metadata'],
    ['instance metadata update'],
    ['instance metadata list', 'instance metadata ls', 'instance metadatas'],
    ['instance metadata get'],
    ['instance metadata delete', 'instance metadata rm'],
    ['ip'],
    ['ssh'],
    ['network'],
    ['network create'],
    ['network list', 'network ls', 'networks'],
    ['network get'],
    ['network get-default'],
    ['network set-default'],
    ['network delete', 'network rm'],
    ['vlan'],
    ['vlan create'],
    ['vlan list', 'vlan ls'],
    ['vlan get'],
    ['vlan update'],
    ['vlan delete', 'vlan rm'],
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
    ['rbac role-tags'],
    ['volume', 'vol'],
    ['volume list', 'volume ls', 'volumes', 'vols'],
    ['volume delete', 'volume rm'],
    ['volume create'],
    ['volume get']
];

// --- Tests

test('triton subcommands', function (subcommandsSuite) {

    // loop each sub command group
    subs.forEach(function (subcmds) {
        subcommandsSuite.test(f('  [%s]', subcmds), function (suite) {
            var out = [];

            // loop each individual subcommand to test
            // triton help <subcmd>
            // triton <subcmd> -h
            subcmds.forEach(function (subcmd) {
                var helpArgs = subcmd.split(' ');
                helpArgs.splice(helpArgs.length - 1, 0, 'help');

                suite.test(f('    triton %s', helpArgs.join(' ')),
                function (t) {
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

                suite.test(f('    triton %s', flagArgs.join(' ')),
                function (t) {
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
                suite.equal(stdout, out[0], 'stdout mismatch');
            });
            suite.end();
        });
    });

    subcommandsSuite.end();
});
