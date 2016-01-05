/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton network get ...`
 */

var format = require('util').format;

var common = require('../common');
var errors = require('../errors');


function do_get(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        return cb(new errors.UsageError(format(
            'incorrect number of args (%d)', args.length)));
    }

    this.top.tritonapi.getNetwork(args[0], function (err, net) {
        if (err) {
            return cb(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(net));
        } else {
            console.log(JSON.stringify(net, null, 4));
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
do_get.help = (
    'Show a network.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} get <id|name>\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_get;
