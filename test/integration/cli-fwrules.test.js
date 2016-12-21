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
var f = require('util').format;
var os = require('os');
var test = require('tape');

// --- Globals

var DESC = 'This rule was created by node-triton tests';
var RULE = 'FROM any TO vm $id ALLOW tcp PORT 80';
var RULE2 = 'FROM any TO vm $id BLOCK tcp port 25';
var INST;
var ID;
var INST_ALIAS = f('nodetritontest-fwrules-%s', os.hostname());
var OPTS = {
    skip: !h.CONFIG.allowWriteActions
};

// --- Tests

if (OPTS.skip) {
    console.error('** skipping %s tests', __filename);
    console.error('** set "allowWriteActions" in test config to enable');
}

test('triton fwrule', OPTS, function (tt) {
    h.printConfig(tt);

    tt.test('  cleanup existing inst with alias ' + INST_ALIAS, function (t) {
        h.deleteTestInst(t, INST_ALIAS, function (err) {
            t.ifErr(err);
            t.end();
        });
    });

    tt.test('  setup: triton create', function (t) {
        h.createTestInst(t, INST_ALIAS, function onInst(err2, instId) {
            if (h.ifErr(t, err2, 'triton instance create'))
                return t.end();

            INST = instId;
            RULE = RULE.replace('$id', INST);
            RULE2 = RULE2.replace('$id', INST);

            t.end();
        });
    });

    tt.test('  triton fwrule create --disabled', function (t) {
        var cmd = f('fwrule create -d "%s"', RULE);
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule create --disabled'))
                return t.end();
            /* JSSTYLED */
            var expected = /^Created firewall rule ([a-f0-9-]{36}) \(disabled\)$/m;
            var match = expected.exec(stdout);
            t.ok(match, f('stdout matches %s: %j', expected, stdout));

            var id = match[1];
            t.ok(id);
            ID = id.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    tt.test('  triton fwrule get (disabled)', function (t) {
        var cmd = 'fwrule get ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule get'))
                return t.end();

            var obj = JSON.parse(stdout);
            t.equal(obj.rule, RULE, 'fwrule rule is correct');
            t.equal(obj.enabled, false, 'fwrule is disabled');
            t.end();
        });
    });

    tt.test('  triton fwrule create', function (t) {
        var cmd = f('fwrule create -D "%s" "%s"', DESC, RULE);

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule create'))
                return t.end();

            /* JSSTYLED */
            var expected = /^Created firewall rule ([a-f0-9-]{36})$/m;
            var match = expected.exec(stdout);
            t.ok(match, f('stdout matches %s: %j', expected, stdout));

            var id = match[1];
            t.ok(id);
            ID = id.match(/^(.+?)-/)[1]; // convert to short ID

            t.end();
        });
    });

    tt.test('  triton fwrule get', function (t) {
        var cmd = 'fwrule get ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule get'))
                return t.end();

            var obj = JSON.parse(stdout);
            t.equal(obj.rule, RULE, 'fwrule rule is correct');
            t.equal(obj.description, DESC, 'fwrule was properly created');
            t.equal(obj.enabled, true, 'fwrule enabled defaults to true');
            t.end();
        });
    });

    tt.test('  triton fwrule enable', function (t) {
        var cmd = 'fwrule enable ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule enable'))
                return t.end();

            t.ok(stdout.match('Enabled firewall rule ' + ID));

            t.end();
        });
    });

    tt.test('  triton fwrule disable', function (t) {
        var cmd = 'fwrule disable ' + ID;

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule disable'))
                return t.end();

            t.ok(stdout.match('Disabled firewall rule ' + ID));

            t.end();
        });
    });

    tt.test('  triton fwrule update', function (t) {
        var cmd = 'fwrule update ' + ID + ' rule="' + RULE2 + '"';

        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule update'))
                return t.end();

            t.ok(stdout.match('Updated firewall rule ' + ID +
                 ' \\(fields: rule\\)'));

            t.end();
        });
    });

    tt.test('  triton fwrule list', function (t) {
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

    tt.test('  triton fwrules', function (t) {
        h.triton('fwrules -l', function (err, stdout, stderr) {
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

    tt.test('  triton fwrule instances', function (t) {
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

    tt.test('  triton instance fwrules', function (t) {
        h.triton('instance fwrules -l ' + INST, function (err, stdout, stderr) {
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

    tt.test('  triton instance fwrule list', function (t) {
        h.triton('instance fwrule list -l ' + INST,
            function (err, stdout, stderr) {
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

    tt.test('  triton fwrule delete', function (t) {
        var cmd = 'fwrule delete ' + ID + ' --force';
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton fwrule delete'))
                return t.end();

            t.ok(stdout.match('Deleted rule ' + ID + ''), 'rule deleted');

            t.end();
        });
    });

    tt.test('  triton instance enable-firewall', function (t) {
        var cmd = 'instance enable-firewall ' + INST + ' -w';
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance enable-firewall'))
                return t.end();

            t.ok(stdout.match('Enabled firewall for instance "' + INST + '"'),
                 'firewall enabled');

            h.triton('instance get -j ' + INST, function (err2, stdout2) {
                if (h.ifErr(t, err2, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout2);
                t.equal(inst.firewall_enabled, true);

                t.end();
            });
        });
    });

    tt.test('  triton instance disable-firewall', function (t) {
        var cmd = 'instance disable-firewall ' + INST + ' -w';
        h.triton(cmd, function (err, stdout, stderr) {
            if (h.ifErr(t, err, 'triton instance disable-firewall'))
                return t.end();

            t.ok(stdout.match('Disabled firewall for instance "' + INST + '"'),
                 'firewall disabled');

            h.triton('instance get -j ' + INST, function (err2, stdout2) {
                if (h.ifErr(t, err2, 'triton instance get'))
                    return t.end();

                var inst = JSON.parse(stdout2);
                t.equal(inst.firewall_enabled, false);

                t.end();
            });
        });
    });

    /*
     * Use a timeout, because '-w' on delete doesn't have a way to know if the
     * attempt failed or if it is just taking a really long time.
     */
    tt.test('  cleanup: triton rm INST', {timeout: 10 * 60 * 1000},
            function (t) {
        h.deleteTestInst(t, INST_ALIAS, function () {
            t.end();
        });
    });
});
