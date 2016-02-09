/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance tag get ...`
 */

var errors = require('../../errors');


function do_get(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    }

    self.top.tritonapi.getInstanceTag({
        id: args[0],
        tag: args[1]
    }, function (err, value) {
        if (err) {
            cb(err);
            return;
        }
        if (opts.json) {
            console.log(JSON.stringify(value));
        } else {
            console.log(value);
        }
        cb();
    });
}

do_get.options = [
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

do_get.help = [
    /* BEGIN JSSTYLED */
    'Get an instance tag.',
    '',
    'Usage:',
    '     {{name}} get <inst> <name>',
    '',
    '{{options}}',
    'Where <inst> is an instance id, name, or shortid and <name> is a tag name.'
    /* END JSSTYLED */
].join('\n');

module.exports = do_get;
