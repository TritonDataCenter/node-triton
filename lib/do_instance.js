/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton instance ...`
 */

var common = require('./common');

function do_instance(subcmd, opts, args, cb) {
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length !== 1) {
        return cb(new Error('invalid args: ' + args));
    }

    this.tritonapi.getInstance(args[0], function (err, inst) {
        if (err) {
            return cb(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(inst));
        } else {
            console.log(JSON.stringify(inst, null, 4));
        }
        cb();
    });
}

do_instance.options = [
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
do_instance.help = (
    'Show a single instance.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} instance <alias|id>\n'
    + '\n'
    + '{{options}}'
);

do_instance.aliases = ['inst'];

module.exports = do_instance;
