/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac user ...`
 */

var errors = require('../errors');



function do_user(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        return cb(new errors.UsageError('incorrect number of args'));
    }

    this.top.tritonapi.getUser({
        id: args[0],
        roles: opts.roles || opts.membership
    }, function onUser(err, user) {
        if (err) {
            return cb(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(user));
        } else {
            console.log(JSON.stringify(user, null, 4));
        }
        cb();
    });
}

do_user.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {
        names: ['roles', 'r'],
        type: 'bool',
        help: 'Include "roles" and "default_roles" this user has.'
    },
    {
        names: ['membership'],
        type: 'bool',
        help: 'Include "roles" and "default_roles" this user has. Included ' +
            'for backward compat with `sdc-user get --membership ...` from ' +
            'node-smartdc.',
        hidden: true
    }
];
do_user.help = (
    /* BEGIN JSSTYLED */
    'Get an RBAC user.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} user [<options>] ID|LOGIN|SHORT-ID\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'Note: Currently this dumps indented JSON by default. That might change\n' +
    'in the future. Use "-j" to explicitly get JSON output.\n'
    /* END JSSTYLED */
);

module.exports = do_user;
