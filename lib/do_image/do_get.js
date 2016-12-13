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

var common = require('../common');
var errors = require('../errors');


function do_get(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        return callback(new errors.UsageError(format(
            'incorrect number of args (%d)', args.length)));
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        tritonapi.getImage(args[0], function onRes(err, img) {
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

do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] IMAGE'];

do_get.help = [
    /* BEGIN JSSTYLED */
    'Get an image.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).',
    '',
    'Note: Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'
    /* END JSSTYLED */
].join('\n');

do_get.completionArgtypes = ['tritonimage', 'none'];

module.exports = do_get;
