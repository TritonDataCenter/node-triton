/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac users ...`
 */

var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');



// columns default without -o
var columnsDefault = 'shortid,login,email,name,cdate';

// columns default with -l
var columnsDefaultLong = 'id,login,email,firstName,lastName,created';

// sort default with -s
var sortDefault = 'login';


function do_users(subcmd, opts, args, cb) {
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

    this.top.tritonapi.cloudapi.listUsers(function (err, users) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(users);
        } else {
            // Add some convenience fields
            for (var i = 0; i < users.length; i++) {
                var user = users[i];
                user.shortid = user.id.split('-', 1)[0];
                user.name = ((user.firstName || '') + ' ' +
                    (user.lastName || '')).trim() || undefined;
                if (user.created) {
                    user.cdate = user.created.slice(0, 10); // Just the date.
                }
                if (user.updated) {
                    user.udate = user.updated.slice(0, 10); // Just the date.
                }
            }

            tabula(users, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
            });
        }
        cb();
    });
}

do_users.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_users.help = (
    /* BEGIN JSSTYLED */
    'List RBAC users.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} users [<options>]\n' +
    '\n' +
    'Fields (most are self explanatory, the client adds some for convenience):\n' +
    '    shortid            A short ID prefix.\n' +
    '    name               "firstName lastName"\n' +
    '    cdate              Just the date portion of "created"\n' +
    '    udate              Just the date portion of "updated"\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);



module.exports = do_users;
