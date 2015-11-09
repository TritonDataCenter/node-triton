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

var ansiStylize = common.ansiStylize;



/*
 * Gather RBAC users, policies, roles and add those to the given `ctx` object.
 */
function gatherRbacBasicInfo(ctx, cb) {
    assert.object(ctx.cloudapi, 'ctx.cloudapi');
    assert.func(cb, 'cb');

    vasync.parallel({funcs: [
        function listUsers(next) {
            ctx.cloudapi.listUsers(function (err, users) {
                ctx.users = users;
                next(err);
            });
        },
        function listPolicies(next) {
            ctx.cloudapi.listPolicies(function (err, policies) {
                ctx.policies = policies;
                next(err);
            });
        },
        function listRoles(next) {
            ctx.cloudapi.listRoles(function (err, roles) {
                ctx.roles = roles;
                next(err);
            });
        }
    ]}, cb);
}


function do_info(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        cb(new errors.UsageError('invalid args: ' + args));
        return;
    }
    var log = this.log;

    var context = {
        tritonapi: this.top.tritonapi,
        cloudapi: this.top.tritonapi.cloudapi
    };
    vasync.pipeline({arg: context, funcs: [
        gatherRbacBasicInfo,
        function gatherUserKeys(ctx, next) {
            if (!opts.all) {
                next();
                return;
            }
            // XXX Q! or concurrency forEachParallel
            vasync.forEachParallel({
                inputs: ctx.users,
                func: function oneUser(user, nextUser) {
                    ctx.cloudapi.listUserKeys({userId: user.id},
                            function (err, userKeys) {
                        user.keys = userKeys;
                        nextUser(err);
                    });
                }
            }, next);
        },
        function fillInUserRoles(ctx, next) {
            var i;
            var userFromLogin = {};
            for (i = 0; i < ctx.users.length; i++) {
                var user = ctx.users[i];
                user.default_roles = [];
                user.roles = [];
                userFromLogin[user.login] = user;
            }
            for (i = 0; i < ctx.roles.length; i++) {
                var role = ctx.roles[i];
                role.default_members.forEach(function (login) {
                    userFromLogin[login].default_roles.push(role.name);
                });
                role.members.forEach(function (login) {
                    userFromLogin[login].roles.push(role.name);
                });
            }
            next();
        },
        function printInfo(ctx, next) {
            var i;
            log.trace({
                users: ctx.users,
                policies: ctx.policies,
                roles: ctx.roles
            }, 'rbac info data');

            console.log('users (%d):', ctx.users.length);
            tabula.sortArrayOfObjects(ctx.users, ['name']);
            for (i = 0; i < ctx.users.length; i++) {
                var user = ctx.users[i];

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

                var roleInfo = [];
                user.default_roles.sort();
                user.roles.sort();
                var roleSeen = {};
                user.default_roles.forEach(function (r) {
                    roleSeen[r] = true;
                    roleInfo.push(r);
                });
                user.roles.forEach(function (r) {
                    if (!roleSeen[r]) {
                        roleInfo.push(r + '*'); // marker for non-default role
                    }
                });
                if (roleInfo.length === 1) {
                    roleInfo = 'role ' + roleInfo.join(', ');
                } else if (roleInfo.length > 0) {
                    roleInfo = 'roles ' + roleInfo.join(', ');
                } else {
                    roleInfo = ansiStylize('no roles', 'red');
                }
                console.log('    %s%s: %s', ansiStylize(user.login, 'bold'),
                    userExtra, roleInfo);
            }

            console.log('roles (%d):', ctx.roles.length);
            tabula.sortArrayOfObjects(ctx.roles, ['name']);
            for (i = 0; i < ctx.roles.length; i++) {
                var role = ctx.roles[i];

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

            console.log('policies (%d):', ctx.policies.length);
            tabula.sortArrayOfObjects(ctx.policies, ['name']);
            for (i = 0; i < ctx.policies.length; i++) {
                var policy = ctx.policies[i];
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
    }
];

do_info.help = (
    /* BEGIN JSSTYLED */
    'Print an account RBAC summary.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} info [<options>]\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);



module.exports = do_info;
