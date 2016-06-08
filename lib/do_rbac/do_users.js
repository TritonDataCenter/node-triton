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



var columnsDefault = 'login,email,name,cdate';
var columnsDefaultLong = 'id,login,email,firstName,lastName,created';
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

do_users.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_users.help = [
    'List RBAC users.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Fields (most are self explanatory, the client adds some for convenience):',
    '    name               "firstName lastName"',
    '    cdate              Just the date portion of "created"',
    '    udate              Just the date portion of "updated"'
].join('\n');


module.exports = do_users;
