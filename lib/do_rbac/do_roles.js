/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac roles ...`
 */

var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');



var columnsDefault = 'name,policies,members,default_members';
var columnsDefaultLong = 'id,name,policies,members,default_members';
var sortDefault = 'name';


function do_roles(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        cb(new errors.UsageError('invalid args: ' + args));
        return;
    }

    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = columnsDefaultLong;
    }
    columns = columns.split(',');
    var sort = opts.s.split(',');

    this.top.tritonapi.cloudapi.listRoles(function (err, roles) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(roles);
        } else {
            var i, j;
            // Add some convenience fields
            for (i = 0; i < roles.length; i++) {
                var role = roles[i];
                role.policies = role.policies.sort().join(',');
                var defaultMap = {};
                for (j = 0; j < role.default_members.length; j++) {
                    defaultMap[role.default_members[j]] = true;
                }
                role.default_members = role.default_members.sort().join(',');
                var sortedRawMembers = role.members.sort();
                var defaultMembers = [];
                var members = [];
                for (j = 0; j < sortedRawMembers.length; j++) {
                    var m = sortedRawMembers[j];
                    if (defaultMap[m]) {
                        defaultMembers.push(m);
                    // TODO: formal envvar with a --no-color top-level opt
                    } else if (process.env.TRITON_NO_COLOR) {
                        members.push(m);
                    } else {
                        members.push(common.ansiStylize(m, 'magenta'));
                    }
                }
                role.members = defaultMembers.concat(members).join(',');
            }

            tabula(roles, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
            });
        }
        cb();
    });
}

do_roles.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_roles.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_roles.help = [
    /* BEGIN JSSTYLED */
    'List RBAC roles.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Fields (most are self explanatory, the client adds some for convenience):',
    '    members            Non-default members (not in the "default_members")',
    '                       are shown in magenta.\n'
    /* END JSSTYLED */
].join('\n');



module.exports = do_roles;
