/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac reset`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var rbac = require('../rbac');

var ansiStylize = common.ansiStylize;


function do_reset(subcmd, opts, args, cb) {
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
        rbacDryRun: opts.dry_run
    };
    vasync.pipeline({arg: context, funcs: [
        function emptyConfig(ctx, next) {
            ctx.rbacConfig = {};
            next();
        },
        rbac.loadRbacState,
        rbac.createRbacUpdatePlan,
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
                if (c.action === 'update') {
                    extra = format(' (%s)',
                        Object.keys(c.diff).map(function (field) {
                            return c.diff[field] + ' ' + field;
                        }).join(', '));
                }
                p('    %s %s %s%s',
                    {create: 'Create', 'delete': 'Delete',
                        update: 'Update'}[c.action],
                    c.desc || c.type,
                    c.id,
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

do_reset.options = [
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
    }
];

do_reset.help = [
    /* BEGIN JSSTYLED */
    'Reset RBAC state for this account.',
    '**Warning: This will delete all RBAC info for this account.**',
    '',
    'Usage:',
    '    {{name}} reset [<options>]',
    '',
    '{{options}}',
    'Warning: Currently, RBAC state updates can take a few seconds to appear',
    'as they are replicated across data centers. This can result in unexpected',
    'no-op updates with consecutive quick re-runs of this command.'
    /* END JSSTYLED */
].join('\n');

do_reset.hidden = true;


module.exports = do_reset;
