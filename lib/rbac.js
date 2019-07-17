/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * RBAC-related support.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var rimraf = require('rimraf');
var sshpk = require('sshpk');
var vasync = require('vasync');

var common = require('./common');
var mod_config = require('./config');
var errors = require('./errors');


// ---- globals

var DEFAULT_RBAC_USER_KEYS_DIR = 'rbac-user-keys';



// ---- internal support stuff

function _rbacStateBasics(ctx, cb) {
    assert.object(ctx.cloudapi, 'ctx.cloudapi');
    assert.func(cb, 'cb');

    vasync.parallel({funcs: [
        function listUsers(next) {
            ctx.cloudapi.listUsers(function (err, users) {
                ctx.rbacState.users = users;
                next(err);
            });
        },
        function listPolicies(next) {
            ctx.cloudapi.listPolicies(function (err, policies) {
                ctx.rbacState.policies = policies;
                next(err);
            });
        },
        function listRoles(next) {
            ctx.cloudapi.listRoles(function (err, roles) {
                ctx.rbacState.roles = roles;
                next(err);
            });
        }
    ]}, cb);
}



/**
 * Take `have` and `want` arrays of things (objects) and return an array of
 * "change" objects describing how to get from 'have' to 'want'.
 *
 * TODO: picture === 1000 words. Give an example.
 *
 * @param opts.type {String} The type of thing being compared.
 * @param opts.desc {String} Optional. A short descriptive phrase for this
 *      thing.
 * @param opts.idField {String} The field with the unique thing id.
 * @param opts.have {Array} Array of things we have already.
 * @param opts.want {Array} Array of things we want to get to.
 * @param opts.crudChangesForCreate {Function} Optional. A function called:
 *          crudChangesForCreate(wantThing)
 *      to return zero or more change objects to add this thing.
 * @param opts.crudChangesForDelete {Function} Optional. A function called:
 *          crudChangesForDelete(haveThing)
 *      to return zero or more change objects to delete this thing.
 * @param opts.normThing {Function} Optional. A function called:
 *          var normalized = normThing(thing);
 *      to normalize a thing before comparing them with `crudChangesForUpdate`.
 * @param opts.crudChangesForUpdate {Function} Optional. A function called:
 *          crudChangesForUpdate(haveThing, wantThing)
 *      to compare to things and return zero or more change objects (of
 *      action="update") for the update. If not specified, the default
 *      comparison is a field-by-field "deepEqual" comparison.
 * @param opts.compareFields {Array} Optional. An alternative to specifying
 *      `opts.crudChangesForUpdate` is to specify an array of field names to
 *      consider. This will be used by the default crudChangesForUpdate.
 */
function crudChangesForThings(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.type, 'opts.type');
    assert.optionalString(opts.desc, 'opts.desc');
    assert.string(opts.idField, 'opts.idField');
    assert.arrayOfObject(opts.have, 'opts.have');
    assert.arrayOfObject(opts.want, 'opts.want');
    assert.optionalFunc(opts.crudChangesForCreate, 'opts.crudChangesForCreate');
    assert.optionalFunc(opts.crudChangesForDelete, 'opts.crudChangesForDelete');
    assert.optionalFunc(opts.normThing, 'opts.normThing');
    assert.optionalFunc(opts.crudChangesForUpdate, 'opts.crudChangesForUpdate');
    assert.optionalArrayOfString(opts.compareFields, 'opts.compareFields');

    var idField = opts.idField;

    var differ = function (a, b) {
        try {
            assert.deepEqual(a, b);
        } catch (err) {
            return true;
        }
        return false;
    };

    var crudChangesForCreate = opts.crudChangesForCreate ||
        function defaultCrudChangesForCreate(wantThing_) {
            return [ {
                action: 'create',
                type: opts.type,
                desc: opts.desc,
                id: wantThing_[idField],
                wantThing: wantThing_
            } ];
        };

    var crudChangesForDelete = opts.crudChangesForDelete ||
        function defaultCrudChangesForDelete(haveThing_) {
            return [ {
                action: 'delete',
                type: opts.type,
                desc: opts.desc,
                id: haveThing_[idField],
                haveThing: haveThing_
            } ];
        };

    var crudChangesForUpdate = opts.crudChangesForUpdate ||
        function defaultUpdatesForThing(haveThing_, wantThing_) {
            var diff = {};
            Object.keys(haveThing_).forEach(function (field) {
                if (! wantThing_.hasOwnProperty(field)) {
                    diff[field] = 'delete';
                } else if (differ(haveThing_[field], wantThing_[field])) {
                    diff[field] = 'update';
                }
            });
            Object.keys(wantThing_).forEach(function (field) {
                if (! haveThing_.hasOwnProperty(field)) {
                    diff[field] = 'add';
                }
            });
            if (opts.compareFields) {
                var filteredDiff = {};
                opts.compareFields.forEach(function (field) {
                    if (diff.hasOwnProperty(field)) {
                        filteredDiff[field] = diff[field];
                    }
                });
                diff = filteredDiff;
            }
            if (Object.keys(diff).length === 0) {
                return [];
            } else {
                return [ {
                    action: 'update',
                    type: opts.type,
                    desc: opts.desc,
                    id: wantThing_[idField],
                    diff: diff,
                    haveThing: haveThing_,
                    wantThing: wantThing_
                } ];
            }
        };

    var normThing = opts.normThing ||
        function defaultNormThing(thing) {
            return thing;
        };

    var haveFromId = {};
    opts.have.forEach(
        function (thing) { haveFromId[thing[idField]] = thing; });
    var wantFromId = {};
    opts.want.forEach(
        function (thing) { wantFromId[thing[idField]] = thing; });

    // Updates and creates.
    var i, haveThing, id;
    var changes = [];
    for (i = 0; i < opts.want.length; ++i) {
        var wantThing = opts.want[i];
        id = wantThing[idField];
        haveThing = haveFromId[id];
        if (haveThing) {
            var updates = crudChangesForUpdate(
                normThing(haveThing), normThing(wantThing));
            changes = changes.concat(updates);
        } else {
            changes = changes.concat(crudChangesForCreate(wantThing));
        }
    }

    // Deletions.
    for (i = 0; i < opts.have.length; ++i) {
        haveThing = opts.have[i];
        id = haveThing[idField];
        if (! wantFromId[id]) {
            changes = changes.concat(crudChangesForDelete(haveThing));
        }
    }

    return changes;
}



// ---- exported functions

/*
 * Load a Triton RBAC config file.
 * TODO: link to docs on this.
 *
 * The result is written to `ctx.rbacConfig`.
 * This calling style is used to facilitate using this in a `vasync.pipeline`.
 *
 * @param ctx {Object} The "context".
 * @param cb {Function} `function (err)`
 */
function loadRbacConfig(ctx, cb) {
    assert.object(ctx, 'ctx');
    assert.string(ctx.rbacConfigPath, 'ctx.rbacConfigPath');
    assert.func(cb, 'cb');

    vasync.pipeline({funcs: [
        function readIt(_, next) {
            fs.readFile(ctx.rbacConfigPath, function (err, data) {
                if (err) {
                    next(err);
                    return;
                }
                try {
                    ctx.rbacConfig = JSON.parse(data);
                } catch (jsonErr) {
                    throw new errors.TritonError(format(
                        'Triton RBAC config file, %s, is not valid JSON: %s',
                        ctx.rbacConfigPath, jsonErr));
                }
                next();
            });
        },

        /*
         * The RBAC config format allows keys to be in a separate file
         * or dir specified with the `<user>.keys` property.
         */
        function loadUserKeys(_, next) {
            vasync.forEachPipeline({
                inputs: ctx.rbacConfig.users || [],
                func: function loadForOneUser(user, nextUser) {
                    var implicit = false;
                    if (!user.hasOwnProperty('keys')) {
                        user.keys = DEFAULT_RBAC_USER_KEYS_DIR;
                        implicit = true;
                    }
                    if (!user.keys || typeof (user.keys) !== 'string') {
                        nextUser();
                        return;
                    }

                    var keysFile = user.keys;
                    try {
                        var stat = fs.statSync(keysFile);
                    } catch (statErr) {
                        if (implicit) {
                            delete user.keys;
                            nextUser();
                            return;
                        }
                        throw new errors.TritonError(format(
                            'User %s keys not found in "%s": %s',
                            user.login, keysFile, statErr));
                    }
                    if (stat.isDirectory()) {
                        keysFile = path.join(user.keys, user.login + '.pub');
                        try {
                            stat = fs.statSync(keysFile);
                        } catch (statErr) {
                            if (implicit) {
                                delete user.keys;
                                nextUser();
                                return;
                            }
                            throw new errors.TritonError(format(
                                'User %s keys not found in "%s": %s',
                                user.login, keysFile, statErr));
                        }
                    }
                    if (!stat.isFile()) {
                        if (implicit) {
                            delete user.keys;
                            nextUser();
                            return;
                        }
                        throw new errors.TritonError(format(
                            'Expected "%s" to be a regular file', keysFile));
                    }

                    var data = fs.readFileSync(keysFile, 'utf8');
                    var lines = data.split(/\r?\n/g);
                    user.keys = [];
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        if (! line.trim()) {
                            continue;
                        }
                        try {
                            var key = sshpk.parseKey(line, 'ssh', keysFile);
                        } catch (keyErr) {
                            // XXX more err details, wrap with TritonError
                            nextUser(keyErr);
                            return;
                        }
                        user.keys.push({
                            fingerprint: key.fingerprint('md5').toString(),
                            name: key.comment || undefined,
                            key: line
                        });
                    }
                    nextUser();
                }
            }, next);
        }

        // XXX Add JSON schema validations
        //      XXX disallow password in the config file
        //      XXX cannot use a login in default_members/members that
        //          isn't in "users"
        // function validateConfig(_, next) {
        // }
    ]}, function (err) {
        cb(err);
    });
}

/*
 * Gather RBAC users, policies, roles and add those to the given `ctx` object.
 *
 * The result is written to `ctx.rbacState`.
 * This calling style is used to facilitate using this in a `vasync.pipeline`.
 *
 * @param ctx {Object} The "context".
 *      - rbacStateAll {Boolean} Set to true to gather extra details like
 *        user keys. Default false.
 * @param cb {Function} `function (err)`
 */
function loadRbacState(ctx, cb) {
    assert.object(ctx.cloudapi, 'ctx.cloudapi');
    assert.object(ctx.log, 'ctx.log');

    var rbacState = ctx.rbacState = {};

    vasync.pipeline({arg: ctx, funcs: [
        _rbacStateBasics,
        function gatherUserKeys(_, next) {
            if (ctx.rbacStateAll) {
                next();
                return;
            }
            // XXX Limit concurrency here!
            // TODO: Optimization: could avoid getting keys for users that are
            // going to be deleted, for the `triton rbac apply` use case.
            vasync.forEachParallel({
                inputs: rbacState.users,
                func: function oneUser(user, nextUser) {
                    ctx.cloudapi.listUserKeys({userId: user.id},
                            function (err, userKeys) {
                        user.keys = userKeys;
                        nextUser(err);
                    });
                }
            }, next);
        },
        function fillInUserRoles(_, next) {
            var i;
            var userFromLogin = {};
            for (i = 0; i < rbacState.users.length; i++) {
                var user = rbacState.users[i];
                user.default_roles = [];
                user.roles = [];
                userFromLogin[user.login] = user;
            }
            for (i = 0; i < rbacState.roles.length; i++) {
                var role = rbacState.roles[i];
                role.default_members.forEach(function (login) {
                    userFromLogin[login].default_roles.push(role.name);
                });
                role.members.forEach(function (login) {
                    userFromLogin[login].roles.push(role.name);
                });
            }
            next();
        }
    ]}, function (err) {
        cb(err);
    });
}


/*
 * For each of users (must be before roles), policies (must be before
 * roles), and roles we calculate updates, creates, and deletions.
 */
function createRbacUpdatePlan(ctx, cb) {
    assert.object(ctx.rbacConfig, 'ctx.rbacConfig');
    assert.object(ctx.rbacState, 'ctx.rbacState');

    // XXX want option to exclude user list from the rbac config?
    // XXX handle user key updates
    // XXX guard for a full delete of all objects of any type
    // XXX guard for removal of a role that resources tagged with that
    //      role could leave orphaned role tags
    // XXX can *rename* of policies and roles be supported?
    //      would need 'id' to be more complex

    var sections = [
        {
            type: 'user',
            desc: 'user',
            idField: 'login',
            have: ctx.rbacState.users || [],
            want: ctx.rbacConfig.users || [],
            /*
             * *User* update is loose: we only compare fields specified in
             * the RBAC config file. Also, user updates include updates to keys.
             */
            crudChangesForUpdate: function userUpdates(haveUser, wantUser) {
                var updates = [];

                var fields = [];
                Object.keys(wantUser).forEach(function (field) {
                    if (field === 'keys') {
                        return;  // keys handled below
                    }
                    if (haveUser[field] !== wantUser[field]) {
                        fields.push(field);
                    }
                });
                if (fields.length) {
                    updates.push({
                        action: 'update',
                        type: 'user',
                        id: haveUser.login,
                        fields: fields,
                        haveThing: haveUser,
                        wantThing: wantUser
                    });
                }

                // Note: If we get fingerprint formats other than 'md5', then
                // id comparison will have to switch to
                // `sshpk.parseKey().matches`.
                var keyChanges = crudChangesForThings({
                    type: 'key',
                    desc: format('user %s key', haveUser.login),
                    idField: 'fingerprint',
                    have: haveUser.keys || [],
                    want: wantUser.keys || []
                });
                keyChanges.forEach(function (c) {
                    c.user = haveUser.login;
                    updates.push(c);
                });

                return updates;
            },
            crudChangesForCreate: function userCreates(wantUser) {
                var creates = [ {
                    action: 'create',
                    type: 'user',
                    id: wantUser.login,
                    wantThing: wantUser
                } ];

                // Add any keys.
                (wantUser.keys || []).forEach(function (key) {
                    creates.push({
                        action: 'create',
                        type: 'key',
                        desc: format('user %s key', wantUser.login),
                        user: wantUser.login,
                        id: key.fingerprint,
                        wantThing: key
                    });
                });

                return creates;
            },

            crudChangesForDelete: function userDeletes(haveUser) {
                var deletes = [];

                (haveUser.keys || []).forEach(function (key) {
                    deletes.push({
                        action: 'delete',
                        type: 'key',
                        desc: format('user %s key', haveUser.login),
                        user: haveUser.login,
                        id: key.fingerprint,
                        haveThing: key
                    });
                });

                deletes.push({
                    action: 'delete',
                    type: 'user',
                    id: haveUser.login,
                    haveThing: haveUser
                });

                return deletes;
            }
        },
        {
            type: 'policy',
            idField: 'name',
            have: ctx.rbacState.policies || [],
            want: ctx.rbacConfig.policies || [],
            compareFields: ['description', 'rules'],
            normThing: function normPolicy(policy) {
                policy.rules.sort();
                return policy;
            }
        },
        {
            type: 'role',
            idField: 'name',
            have: ctx.rbacState.roles || [],
            want: ctx.rbacConfig.roles || [],
            compareFields: [
                'members',
                'default_members',
                'policies'
            ],
            normThing: function normRole(role) {
                role.members.sort();
                role.default_members.sort();
                role.policies.sort();
                return role;
            }
        }
    ];


    var changes = [];
    sections.forEach(function (section) {
        var someChanges = crudChangesForThings(section);
        changes = changes.concat(someChanges);
    });

    ctx.rbacUpdatePlan = changes;
    cb();
}

function executeRbacUpdatePlan(ctx, cb) {
    assert.object(ctx.log, 'ctx.log');
    assert.arrayOfObject(ctx.rbacUpdatePlan, 'ctx.rbacUpdatePlan');
    assert.object(ctx.cloudapi, 'ctx.cloudapi');
    assert.optionalBool(ctx.rbacDryRun, 'ctx.rbacDryRun');

    // TODO: ctx.progress instead of console.log

    vasync.forEachPipeline({
        inputs: ctx.rbacUpdatePlan,
        func: function executeOneChange(c, next) {
            ctx.log.info({change: c, dryRun: ctx.rbacDryRun},
                'execute rbac update change');
            var extra, delOpts, updateOpts, i;

            if (ctx.rbacDryRun) {
                console.log('[dry-run] %s %s %s', c.action,
                    c.desc || c.type, c.id);
                next();
                return;
            }

            switch (c.action + '-' + c.type) {
            case 'create-user':
                // Generate (throw away) password, if necessary.
                if (! c.wantThing.hasOwnProperty('password')) {
                    c.wantThing.password = common.generatePassword();
                }
                ctx.cloudapi.createUser(c.wantThing, function (err, user_) {
                    if (err) {
                        next(err);
                        return;
                    }

                    console.log('Created user %s (use `triton rbac passwd ' +
                        '%s` to change password)', c.wantThing.login,
                        c.wantThing.login);
                    next();
                });
                break;
            case 'update-user':
                updateOpts = {id: c.wantThing.login};
                extra = [];
                Object.keys(c.diff).forEach(function (field) {
                    updateOpts[field] = c.wantThing[field];
                    extra.push(format('%s=%s', field, c.wantThing[field]));
                });
                ctx.cloudapi.updateUser(updateOpts, function (err, user_) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Updated user %s: %s', c.wantThing.login,
                        extra.join(', '));
                    next();
                });
                break;
            case 'delete-user':
                delOpts = {id: c.haveThing.login};
                ctx.cloudapi.deleteUser(delOpts, function (err) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Deleted user %s', c.haveThing.login);
                    next();
                });
                break;

            case 'create-key':
                ctx.cloudapi.createUserKey({
                    userId: c.user,
                    key: c.wantThing.key,
                    name: c.wantThing.name
                }, function (err, key) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Created user %s key %s%s', c.user,
                        key.fingerprint,
                        key.name ? format(' (%s)', key.name) : '');
                    next();
                });
                break;
            case 'update-key':
                vasync.pipeline({funcs: [
                    function delKey(_, next2) {
                        ctx.cloudapi.deleteUserKey({
                            userId: c.user,
                            fingerprint: c.haveThing.fingerprint
                        }, next2);
                    },
                    function createKey(_, next2) {
                        ctx.cloudapi.createUserKey({
                            userId: c.user,
                            key: c.wantThing.key,
                            name: c.wantThing.name
                        }, next2);
                    },
                    function noteIt(_, next2) {
                        extra = Object.keys(c.diff).map(function (field) {
                            if (field === 'key') {
                                return 'key=...';
                            }
                            return format('%s=%s', field, c.wantThing[field]);
                        });
                        console.log('Updated user %s key %s: %s',
                            c.user, c.wantThing.fingerprint, extra.join(', '));
                        next2();
                    }
                ]}, next);
                break;
            case 'delete-key':
                ctx.cloudapi.deleteUserKey({
                    userId: c.user,
                    fingerprint: c.haveThing.fingerprint
                }, function (err) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Deleted user %s key %s', c.user,
                        c.haveThing.fingerprint);
                    next();
                });
                break;

            case 'create-policy':
                ctx.cloudapi.createPolicy(c.wantThing, function (err, poli) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Created policy %s (%s rule%s)', poli.name,
                        poli.rules.length, poli.rules.length === 1 ? '' : 's');
                    next();
                });
                break;
            case 'update-policy':
                updateOpts = {id: c.haveThing.id}; // UpdatePolicy requires `id`
                extra = [];
                Object.keys(c.diff).forEach(function (field) {
                    updateOpts[field] = c.wantThing[field];
                    if (field === 'rules') {
                        // XXX This is poor for large rules update.
                        extra.push(format('%s=%s', field,
                            c.wantThing[field].join(';')));
                    } else {
                        extra.push(format('%s=%s', field, c.wantThing[field]));
                    }
                });
                ctx.cloudapi.updatePolicy(updateOpts, function (err, poli) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Updated policy %s: %s', poli.name,
                        extra.join(', '));
                    next();
                });
                break;
            case 'delete-policy':
                delOpts = {id: c.haveThing.id}; // DeletePolicy requires `id`.
                ctx.cloudapi.deletePolicy(delOpts, function (err) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Deleted policy %s', c.haveThing.name);
                    next();
                });
                break;

            case 'create-role':
                ctx.cloudapi.createRole(c.wantThing, function (err, role) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Created role %s (%s member%s)',
                        role.name, role.members.length,
                        role.members.length === 1 ? '' : 's');
                    next();
                });
                break;
            case 'update-role':
                updateOpts = {id: c.wantThing.name};
                extra = [];
                Object.keys(c.diff).forEach(function (field) {
                    updateOpts[field] = c.wantThing[field];
                    extra.push(format('%s=%s', field, c.wantThing[field]));
                });
                ctx.cloudapi.updateRole(updateOpts, function (err, role) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Updated role %s: %s', role.name,
                        extra.join(', '));
                    next();
                });
                break;
            case 'delete-role':
                delOpts = {id: c.haveThing.id};
                ctx.cloudapi.deleteRole(delOpts, function (err) {
                    if (err) {
                        next(err);
                        return;
                    }
                    console.log('Deleted role %s', c.haveThing.name);
                    next();
                });
                break;

            case 'generate-key':
                console.log('Generating and adding new SSH key for user %s:',
                    c.user);
                vasync.pipeline({arg: {}, funcs: [
                    function vars(ctx2, next2) {
                        ctx2.homeDir = common.tildeSync('~');
                        ctx2.keyName = format('%s user %s',
                            c.currProfile.name, c.user);
                        ctx2.keyPath = path.resolve(ctx2.homeDir, '.ssh',
                            format('%s-user-%s.id_rsa',
                                c.currProfile.name, c.user));
                        next2();
                    },
                    function rmOldPrivKey(ctx2, next2) {
                        rimraf(ctx2.keyPath, next2);
                    },
                    function rmOldPubKey(ctx2, next2) {
                        rimraf(ctx2.keyPath + '.pub', next2);
                    },
                    function generateSshKey(ctx2, next2) {
                        var cmd = format(
                            'ssh-keygen -t rsa -m PEM -C "%s" -f %s -b 4096',
                            ctx2.keyName, ctx2.keyPath);
                        console.log('    Generate 4096 bit RSA key: %s[.pub]',
                            ctx2.keyPath);
                        common.execPlus({cmd: cmd, log: ctx.log}, next2);
                    },
                    function loadPubKey(ctx2, next2) {
                        fs.readFile(ctx2.keyPath + '.pub', 'utf8',
                                function (err, content) {
                            ctx2.pubKeyContent = content;
                            next2();
                        });
                    },
                    function pubKeyCopyInRbacConfigDir(ctx2, next2) {
                        mkdirp(DEFAULT_RBAC_USER_KEYS_DIR, function (err) {
                            if (err) {
                                next(err);
                                return;
                            }
                            var configKeyPath = path.join(
                                DEFAULT_RBAC_USER_KEYS_DIR, c.user + '.pub');
                            console.log('    Copy pubkey to %s', configKeyPath);
                            fs.writeFile(configKeyPath, ctx2.pubKeyContent,
                                next2);
                        });
                    },
                    function addKey(ctx2, next2) {
                        ctx.cloudapi.createUserKey({
                            userId: c.user,
                            key: ctx2.pubKeyContent,
                            name: ctx2.keyName
                        }, function (err, key) {
                            if (err) {
                                next2(err);
                                return;
                            }
                            ctx2.key = key;
                            console.log('    Created user %s key %s%s', c.user,
                                key.fingerprint,
                                key.name ? format(' (%s)', key.name) : '');
                            next2();
                        });
                    },
                    function addKeyToRbacConfig(ctx2, next2) {
                        for (i = 0; i < ctx.rbacConfig.users.length; i++) {
                            var u = ctx.rbacConfig.users[i];
                            if (u.login === c.user) {
                                assert.ok(!u.keys,
                                    'expect no keys on user ' + c.user);
                                u.keys = [ctx2.key];
                                break;
                            }
                        }
                        next2();
                    }
                ]}, next);
                break;

            case 'create-profile':
            case 'update-profile':
                if (!c.wantThing.keyId) {
                    // Add from the recently generated/added key.
                    for (i = 0; i < ctx.rbacConfig.users.length; i++) {
                        var user = ctx.rbacConfig.users[i];
                        if (user.login === c.user) {
                            c.wantThing.keyId = user.keys[0].fingerprint;
                            break;
                        }
                    }
                }

                try {
                    mod_config.validateProfile(c.wantThing);
                } catch (err) {
                    next(err);
                    break;
                }

                try {
                    mod_config.saveProfileSync({
                        configDir: c.configDir,
                        profile: c.wantThing
                    });
                } catch (err) {
                    return next(err);
                }

                next();
                break;

            default:
                throw new Error(format(
                    'unknown action-type: %s-%s', c.action, c.type));
            }
        }

    }, function (err) {
        cb(err);
    });
}


module.exports = {
    loadRbacConfig: loadRbacConfig,
    loadRbacState: loadRbacState,
    createRbacUpdatePlan: createRbacUpdatePlan,
    executeRbacUpdatePlan: executeRbacUpdatePlan
};
