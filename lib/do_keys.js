/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton keys ...`
 */

var common = require('./common');
var errors = require('./errors');


function do_keys(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        cb(new errors.UsageError('invalid args: ' + args));
        return;
    }

    this.tritonapi.cloudapi.listKeys(function (err, keys) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(keys);
        } else {
            keys.forEach(function (key) {
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
    'Show account SSH keys.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} keys [<options>]\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'By default this lists just the key content for each key -- in other\n'
    + 'words, content appropriate for a "~/.ssh/authorized_keys" file.\n'
    + 'Use `triton keys -j` to see all fields.\n'
);

module.exports = do_keys;
