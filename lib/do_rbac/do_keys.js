/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac keys ...`
 */

var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');


var columnsDefault = 'fingerprint,name';
var columnsDefaultLong = 'fingerprint,name,key';
var sortDefault = 'name';


function do_keys(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length === 0) {
        cb(new errors.UsageError('no USER argument given'));
        return;
    } else if (args.length !== 1) {
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

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        tritonapi.cloudapi.listUserKeys({userId: args[0]},
                function (err, userKeys) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                common.jsonStream(userKeys);
            } else if (opts.authorized_keys) {
                userKeys.forEach(function (key) {
                    console.log(common.chomp(key.key));
                });
            } else {
                tabula(userKeys, {
                    skipHeader: false,
                    columns: columns,
                    sort: sort
                });
            }
            cb();
        });
    });
}

do_keys.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
})).concat([
    {
        names: ['authorized-keys', 'A'],
        type: 'bool',
        help: 'Just output public key data -- i.e. output appropriate for a ' +
            '"~/.ssh/authorized_keys" file.'
    }
]);

do_keys.synopses = ['{{name}} {{cmd}} [OPTIONS] USER'];

do_keys.help = [
    /* BEGIN JSSTYLED */
    'List RBAC user SSH keys.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "USER" is an RBAC user login or id (a UUID).'
    /* END JSSTYLED */
].join('\n');


module.exports = do_keys;
