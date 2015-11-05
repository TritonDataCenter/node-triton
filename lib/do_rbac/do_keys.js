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

var common = require('../common');
var errors = require('../errors');



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

    this.top.tritonapi.cloudapi.listUserKeys({userId: args[0]},
            function (err, userKeys) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(userKeys);
        } else {
            userKeys.forEach(function (key) {
                console.log(common.chomp(key.key));
            });
        }
        cb();
    });
}

do_keys.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_keys.help = (
    /* BEGIN JSSTYLED */
    'List RBAC user SSH keys.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} keys [<options>] USER\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'Where "USER" is an RBAC user id, login or short id. By default this\n' +
    'lists just the key content for each key -- in other words, content\n' +
    'appropriate for a "~/.ssh/authorized_keys" file.\n' +
    'Use `{{name}} keys -j USER` to see all fields.\n'
    /* END JSSTYLED */
);



module.exports = do_keys;
