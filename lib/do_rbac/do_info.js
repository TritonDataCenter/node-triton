/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac info ...`
 */

/* BEGIN JSSTYLED */
/*

Sample output for development/discussion:

```
users ($numUsers):
    bob ($fullname, **no ssh keys**): roles web*
    carl (Carl Fogel): roles eng, operator*, cibot*, monbot*
    ...
roles ($numRoles):
    eng: policies write, read                   # include users here?
    ops: policies delete, read, write
    support: policies read
policies ($numPolicies):
    delete ($desc):
        can deletemachine
    read (cloudapi read-only actions):
        can listmachines, getmachine and listimages
    write (cloudapi write (non-delete) actions):
        can createmachine, updatemachine, stopmachine and startmachine
resources:   # or call this 'resources'? role-tags?
    # some dump of all resources (perhaps not default to *all*) and their
    # role-tags
    instance foo0 ($uuid): role-tags eng
    image bar@1.2.3 ($uuid): role-tags ops
```

Ideas:
- red warning about users with no keys
- `triton rbac info -u bob`   Show everything from bob's p.o.v.
- `triton rbac info -r readonly`   Show everything from this role's p.o.v.
    `... --instance foo0`, etc.
- `-t|--role-tags` to include the role tag info. Perhaps with arg for which?
  E.g. do we traverse all machines, images, networks? That could too much...
  Might need cloudapi support for returning those optionally.
    ListImages?fields=*,role_tags   # perhaps don't support '*'
*/
/* END JSSTYLED */


var assert = require('assert-plus');
var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var rbac = require('../rbac');

function do_info(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        cb(new errors.UsageError('invalid args: ' + args));
        return;
    }
    var log = this.log;

    var ansiStylize = common.ansiStylize;
    if (!process.stdout.isTTY || opts.no_color) {
        ansiStylize = function (s) { return s; };
    }

    var context = {
        log: this.log,
        tritonapi: this.top.tritonapi,
        cloudapi: this.top.tritonapi.cloudapi,
        rbacStateAll: opts.all
    };

    var cli = this.top;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: context, funcs: [
        function cliSetupTritonApi(ctx, next) {
            common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
                ctx.cloudapi = tritonapi.cloudapi;
                next();
            });
        },

        rbac.loadRbacState,

        function printInfo(ctx, next) {
            var i;
            log.trace({rbacState: ctx.rbacState}, 'rbacState');

            console.log('users (%d):', ctx.rbacState.users.length);
            tabula.sortArrayOfObjects(ctx.rbacState.users, ['name']);
            for (i = 0; i < ctx.rbacState.users.length; i++) {
                var user = ctx.rbacState.users[i];

                var userExtra = [];
                if (user.firstName || user.lastName) {
                    userExtra.push(((user.firstName || '') + ' ' +
                        (user.lastName || '')).trim());
                }
                if (user.keys && user.keys.length === 0) {
                    userExtra.push(ansiStylize('no ssh keys', 'red'));
                }
                if (userExtra.length > 0) {
                    userExtra = format(' (%s)', userExtra.join(', '));
                } else {
                    userExtra = '';
                }

                var numRoles = 0;
                var roleInfo = '';
                user.default_roles.sort();
                user.roles.sort();
                var roleSeen = {};
                user.default_roles.forEach(function (r) {
                    numRoles++;
                    roleSeen[r] = true;
                    if (roleInfo) {
                        roleInfo += ', ';
                    }
                    roleInfo += r;
                });
                var nonDefaultRoles = user.roles.filter(function (r) {
                    return !roleSeen[r];
                });
                if (nonDefaultRoles.length > 0) {
                    numRoles += nonDefaultRoles.length;
                    if (numRoles > 0) {
                        roleInfo += '[, ';
                    } else {
                        roleInfo += '[';
                    }
                    roleInfo += nonDefaultRoles.join(', ');
                    roleInfo += ']';
                }
                if (numRoles === 1) {
                    roleInfo = 'role ' + roleInfo;
                } else if (numRoles > 0) {
                    roleInfo = 'roles ' + roleInfo;
                } else {
                    roleInfo = ansiStylize('no roles', 'red');
                }
                console.log('    %s%s: %s', ansiStylize(user.login, 'bold'),
                    userExtra, roleInfo);
            }

            console.log('roles (%d):', ctx.rbacState.roles.length);
            tabula.sortArrayOfObjects(ctx.rbacState.roles, ['name']);
            for (i = 0; i < ctx.rbacState.roles.length; i++) {
                var role = ctx.rbacState.roles[i];

                var policyInfo;
                if (role.policies.length === 1) {
                    policyInfo = 'policy ' + role.policies.join(', ');
                } else if (role.policies.length > 0) {
                    policyInfo = 'policies ' + role.policies.join(', ');
                } else {
                    policyInfo = ansiStylize('no policies', 'red');
                }
                console.log('    %s: %s', ansiStylize(role.name, 'bold'),
                    policyInfo);
            }

            console.log('policies (%d):', ctx.rbacState.policies.length);
            tabula.sortArrayOfObjects(ctx.rbacState.policies, ['name']);
            for (i = 0; i < ctx.rbacState.policies.length; i++) {
                var policy = ctx.rbacState.policies[i];
                var noRules = '';
                if (policy.rules.length === 0) {
                    noRules = ' ' + ansiStylize('no rules', 'red');
                }
                if (policy.description) {
                    console.log('    %s (%s) rules:%s',
                        ansiStylize(policy.name, 'bold'),
                        policy.description, noRules);
                } else {
                    console.log('    %s rules:%s',
                        ansiStylize(policy.name, 'bold'), noRules);
                }
                policy.rules.forEach(function (r) {
                    console.log('        %s', r);
                });
            }

            next();
        }
    ]}, function (err) {
        cb(err);
    });
}

do_info.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['all', 'a'],
        type: 'bool',
        help: 'Include all info for a more full report. This requires more ' +
            'work to gather all info.'
    },
    {
        names: ['no-color'],
        type: 'bool',
        help: 'Do not color some of the output with ANSI codes.'
    }
];

do_info.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_info.help = [
    /* BEGIN JSSTYLED */
    'Show current RBAC state.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'List RBAC users, roles and policies and. This summary does not show all',
    'data for these objects, but attempts to highlight important relationships',
    'to give a succinct overview.',
    '',
    'Example:',
    '    users (2):                         # Number of users in parentheses',
    '                                       # A user\'s roles from the role object',
    '        alice: roles ops[, admin]      # Alice\'s roles, non-default ones in brackets',
    '        bill (no ssh keys): role eng   # A warning that bill has no SSH key',
    '    roles (3):                         # "$roleName: policy $policyName',
    '        admin: policy policy-admin',
    '        eng: policy policy-full',
    '        ops: policy policy-readonly',
    '    policies (3):                      # "$name ($description) rules:"',
    '        policy-admin (full access) rules:',
    '            CAN *                      # The rules on the policy',
    '        policy-full (full access, except rbac) rules:',
    '            CAN compute:*',
    '        policy-readonly (read-only access) rules:',
    '            CAN compute:Get*'
    /* END JSSTYLED */
].join('\n');



module.exports = do_info;
