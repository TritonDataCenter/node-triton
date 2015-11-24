/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac apply ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var mod_config = require('../config');
var errors = require('../errors');
var rbac = require('../rbac');

var ansiStylize = common.ansiStylize;


function do_apply(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        cb(new errors.UsageError('invalid args: ' + args));
        return;
    }

    var context = {
        log: this.log,
        tritonapi: this.top.tritonapi,
        cloudapi: this.top.tritonapi.cloudapi,
        rbacConfigPath: opts.file || './rbac.json',
        rbacDryRun: opts.dry_run
    };
    vasync.pipeline({arg: context, funcs: [
        rbac.loadRbacConfig,
        rbac.loadRbacState,
        rbac.createRbacUpdatePlan,

        /*
         * For each user (in the target config):
         * - if they don't have a key and one isn't being added in the plan
         *   already, then we want to create an ssh key pair and add it; and
         * - add or replace the '$currprofile-user-$login' Triton CLI
         *   profile
         */
        function devExtendKeys(ctx, next) {
            if (!opts.dev_create_keys_and_profiles) {
                next();
                return;
            }

            ctx.rbacConfig.users.forEach(function devUserKey(user) {
                if (user.keys && user.keys.length > 0) {
                    return;
                }
                ctx.rbacUpdatePlan.push({
                    action: 'generate',
                    type: 'key',
                    desc: format('user %s key', user.login),
                    currProfile: ctx.tritonapi.profile,
                    user: user.login
                });
            });
            next();
        },

        function devExtendProfiles(ctx, next) {
            if (!opts.dev_create_keys_and_profiles) {
                next();
                return;
            }

            var profiles = mod_config.loadAllProfiles({
                configDir: self.top.configDir,
                log: self.log
            });
            var profileFromName = {};
            profiles.forEach(function (p) {
                profileFromName[p.name] = p;
            });

            ctx.rbacConfig.users.forEach(function devUserKey(user) {
                var profileName = format('%s-user-%s',
                    ctx.tritonapi.profile.name, user.login);
                var wantThing = {
                    name: profileName,
                    url: ctx.tritonapi.profile.url,
                    insecure: ctx.tritonapi.profile.insecure,
                    account: ctx.tritonapi.profile.account,
                    user: user.login,
                    // If we are adding a key, we won't have this fingerprint
                    // until after executing that part of the rbacUpdatePlan.
                    keyId: user.keys && user.keys[0].fingerprint
                };
                var existing = profileFromName[profileName];
                if (existing) {
                    // If it is the same, avoid no-op update.
                    if (! common.deepEqual(wantThing, existing)) {
                        ctx.rbacUpdatePlan.push({
                            action: 'update',
                            type: 'profile',
                            desc: format('user %s CLI profile', user.login),
                            id: profileName,
                            haveThing: existing,
                            wantThing: wantThing,
                            user: user.login,
                            configDir: self.top.configDir
                        });
                    }
                } else {
                    ctx.rbacUpdatePlan.push({
                        action: 'create',
                        type: 'profile',
                        desc: format('user %s CLI profile', user.login),
                        id: profileName,
                        wantThing: wantThing,
                        user: user.login,
                        configDir: self.top.configDir
                    });
                }
            });
            next();
        },

        function confirmApply(ctx, next) {
            if (opts.yes || ctx.rbacUpdatePlan.length === 0) {
                next();
                return;
            }
            ctx.log.info({rbacUpdatePlan: ctx.rbacUpdatePlan},
                'rbacUpdatePlan');
            var p = console.log;
            p('');
            p('This will make the following RBAC config changes:');
            ctx.rbacUpdatePlan.forEach(function (c) {
                var extra = '';
                if (c.action === 'update' && c.diff) {
                    extra = format(' (%s)',
                        Object.keys(c.diff).map(function (field) {
                            return c.diff[field] + ' ' + field;
                        }).join(', '));
                }
                p('    %s %s %s%s',
                    {create: 'Create', 'delete': 'Delete',
                        update: 'Update', generate: 'Generate'}[c.action],
                    c.desc || c.type,
                    c.id || '',
                    extra);
            });
            p('');
            var msg = format('Would you like to continue%s? [y/N] ',
                opts.dry_run ? ' (dry-run)' : '');
            common.promptYesNo({msg: msg, default: 'n'}, function (answer) {
                if (answer !== 'y') {
                    p('Aborting update');
                    return cb();
                }
                p('');
                next();
            });
        },
        rbac.executeRbacUpdatePlan
    ]}, function (err) {
        cb(err);
    });
}

do_apply.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['dry-run', 'n'],
        type: 'bool',
        help: 'Go through the motions without applying changes.'
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer "yes" to confirmation.'
    },
    {
        names: ['file', 'f'],
        type: 'string',
        helpArg: 'FILE',
        help: 'RBAC config JSON file.'
    },
    {
        names: ['dev-create-keys-and-profiles'],
        type: 'bool',
        help: 'Convenient option to generate keys and Triton CLI profiles ' +
            'for all users. For experimenting only. See section below.'
    }
];

do_apply.help = [
    /* BEGIN JSSTYLED */
    'Apply an RBAC configuration.',
    '',
    'Usage:',
    '    {{name}} apply [<options>]',
    '',
    '{{options}}',
    'If "--file FILE" is not specified, this defaults to using "./rbac.json".',
    'The RBAC configuration is loaded from FILE and compared to the live',
    'RBAC state (see `triton rbac info`). It then calculates necessary updates,',
    'confirms, and applies them.',
    '',
    'Warning: Currently, RBAC state updates can take a few seconds to appear',
    'as they are replicated across data centers. This can result in unexpected',
    'no-op updates with consecutive quick re-runs of this command.',
    '',
    'The "--dev-create-keys-and-profiles" option is provided for **experimenting',
    'with, developing, or testing** Triton RBAC. It will create a key and setup a ',
    'Triton CLI profile for each user (named "$currprofile-user-$login"). This ',
    'simplies using the CLI as that user:',
    '    triton -p coal-user-bob create ...',
    '    triton -p coal-user-sarah imgs',
    'Note that proper production usage of RBAC should have the administrator',
    'never seeing each user\'s private key.',
    '',
    'TODO: Document the rbac.json configuration format.'
    /* END JSSTYLED */
].join('\n');



module.exports = do_apply;
