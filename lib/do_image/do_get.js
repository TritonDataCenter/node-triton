/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton image get ...`
 */

var format = require('util').format;

var errors = require('../errors');


function do_get(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        return callback(new errors.UsageError(format(
            'incorrect number of args (%d)', args.length)));
    }

    this.top.tritonapi.getImage(args[0], function onRes(err, img) {
        if (err) {
            return callback(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(img));
        } else {
            console.log(JSON.stringify(img, null, 4));
        }
        callback();
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
        help: 'JSON stream output.'
    }
];
do_get.help = (
    /* BEGIN JSSTYLED */
    'Get an image.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} get [<options>] ID|NAME\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'If there is more than one image with the given "NAME", the latest\n' +
    'image (by "published_at") is returned.\n' +
    '\n' +
    'Note: Currently this dumps prettified JSON by default. That might change\n' +
    'in the future. Use "-j" to explicitly get JSON output.\n'
    /* END JSSTYLED */
);

do_get.completionArgtypes = ['tritonimage', 'none'];

module.exports = do_get;
