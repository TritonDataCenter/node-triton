/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton key list ...`
 */

var assert = require('assert-plus');

var common = require('../common');
var errors = require('../errors');


function do_list(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length > 0) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;

    cli.tritonapi.cloudapi.listKeys({}, function onKeys(err, keys) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(keys));
        } else {
            keys.forEach(function (key) {
                console.log(common.chomp(key.key));
            });
        }
        cb();
    });
}


do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];
do_list.help = [
    'Show all of an account\'s SSH keys.',
    '',
    'Usage:',
    '     {{name}} list [<options>]',
    '',
    '{{options}}',
    '',
    'By default this lists just the key content for each key -- in other',
    'words, content appropriate for a "~/.ssh/authorized_keys" file.',
    'Use `triton keys -j` to see all fields.'
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
