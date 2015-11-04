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



// columns default without -o
var columnsDefault = 'shortid,name,policies,members';

// columns default with -l
var columnsDefaultLong = 'shortid,name,policies,members,default_members';

// sort default with -s
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
                role.shortid = role.id.split('-', 1)[0];
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

do_roles.help = (
    /* BEGIN JSSTYLED */
    'List RBAC roles.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} roles [<options>]\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'Fields (most are self explanatory, the client adds some for convenience):\n' +
    '    shortid            A short ID prefix.\n' +
    '    members            Non-default members (not in the "default_members")\n' +
    '                       are shown in magenta.\n'
    /* END JSSTYLED */
);



module.exports = do_roles;
