/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Integration tests for `triton fwrules ...`
 */

var h = require('./helpers');
var format = require('util').format;
var test = require('tape');

// --- Globals

var DESC = 'This rule was created by node-triton tests';
var RULE = 'FROM any TO vm $id ALLOW tcp PORT 80';
var RULE2 = 'FROM any TO vm $id BLOCK tcp port 25';
var INST;
var ID;
var FAKE_INST_UUID = '89bcb9de-f174-4f20-bfa8-27d9749e6a2c';

// --- Tests

test('triton fwrule', function (tt) {
    tt.test('setup', function (t) {
        h.triton('insts -j', function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton insts'))
                return t.end();

            var rows = stdout.split('\n');
            try {
                INST = JSON.parse(rows[0]).id;
                RULE = RULE.replace('$id', INST);
                RULE2 = RULE2.replace('$id', INST);
            } catch (e) {
                // if we don't have a VM already running to test with, we'll
                // run most tests with a fake UUID, and skip any tests that
                // require an actual machine UUID
                RULE = RULE.replace('$id', FAKE_INST_UUID);
                RULE2 = RULE2.replace('$id', FAKE_INST_UUID);
            }

            t.end();
        });
    });

    tt.test(' triton fwrule create', function (t) {
        var cmd = format('fwrule create -d "%s" "%s"', DESC, RULE);

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule create'))
                return t.end();

            var match = stdout.match('Created firewall rule (.+)');
            t.ok(match, 'fwrule made');

            ID = match[1];
            t.ok(ID);

            t.end();
        });
    });

    tt.test(' triton fwrule get', function (t) {
        var cmd = 'fwrule get ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule get'))
                return t.end();

            var obj = JSON.parse(stdout);
            t.equal(obj.rule, RULE, 'fwrule rule is correct');
            t.equal(obj.description, DESC, 'fwrule was properly created');
            t.equal(obj.enabled, false, 'fwrule enabled defaults to false');

            t.end();
        });
    });

    tt.test(' triton fwrule enable', function (t) {
        var cmd = 'fwrule enable ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule enable'))
                return t.end();

            t.ok(stdout.match('Enabled firewall rule ' + ID));

            t.end();
        });
    });

    tt.test(' triton fwrule disable', function (t) {
        var cmd = 'fwrule disable ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule disable'))
                return t.end();

            t.ok(stdout.match('Disabled firewall rule ' + ID));

            t.end();
        });
    });

    tt.test(' triton fwrule update', function (t) {
        var cmd = 'fwrule update rule="' + RULE2 + '" ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule disable'))
                return t.end();

            t.ok(stdout.match('Updated firewall rule ' + ID +
                 ' \\(fields: rule\\)'));

            t.end();
        });
    });

    tt.test(' triton fwrule list', function (t) {
        h.triton('fwrule list -l', function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule list'))
                return t.end();

            var rules = stdout.split('\n');
            t.ok(rules[0].match(/ID\s+ENABLED\s+GLOBAL\s+RULE\s+DESCRIPTION/));
            rules.shift();

            t.ok(rules.length >= 1, 'triton fwrule list expected fwrule num');

            var testRules = rules.filter(function (rule) {
                return rule.match(ID);
            });

            t.equal(testRules.length, 1, 'triton fwrule list test rule found');

            t.end();
        });
    });

    tt.test(' triton fwrule instances', function (t) {
        h.triton('fwrule instances -l ' + ID, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule instances'))
                return t.end();

            var machines = stdout.split('\n').filter(function (machine) {
                return machine !== '';
            });
            t.ok(machines[0].match(/ID\s+NAME\s+IMG\s+BRAND/));
            machines.shift();

            if (!INST)
                return t.end();

            t.equal(machines.length, 1, 'triton fwrule instances expected ' +
                    'num machines');

            var testMachines = machines.filter(function (machine) {
                return machine.match(INST);
            });

            t.equal(testMachines.length, 1, 'triton fwrule instances test ' +
                    'machine found');

            t.end();
        });
    });

    tt.test(' triton instance fwrules', function (t) {
        h.triton('instance fwrules -l ' + ID, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule list'))
                return t.end();

            var rules = stdout.split('\n');
            t.ok(rules[0].match(/ID\s+ENABLED\s+GLOBAL\s+RULE\s+DESCRIPTION/));
            rules.shift();

            t.ok(rules.length >= 1, 'triton fwrule list expected fwrule num');

            var testRules = rules.filter(function (rule) {
                return rule.match(ID);
            });

            t.equal(testRules.length, 1, 'triton fwrule list test rule found');

            t.end();
        });
    });

    tt.test(' triton fwrule delete', function (t) {
        var cmd = 'fwrule delete ' + ID + ' --force';
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule delete'))
                return t.end();

            t.ok(stdout.match('Deleted rule ' + ID + ''), 'rule deleted');

            t.end();
        });
    });
});
