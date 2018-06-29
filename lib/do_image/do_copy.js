/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 *
 * `triton image copy ...`
 */

var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');

// ---- the command

function do_copy(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        cb(new errors.UsageError(
            'incorrect number of args: expected 2, got ' + args.length));
        return;
    }

    var log = this.top.log;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function copyImage(ctx, next) {
            log.trace({dryRun: opts.dry_run, account: ctx.account, args: args},
                'image copy');

            if (opts.dry_run) {
                next();
                return;
            }

            tritonapi.copyImageToDatacenter(
                    {image: args[0], datacenter: args[1]},
                    function (err, img) {
                if (err) {
                    next(new errors.TritonError(err, 'error copying image'));
                    return;
                }

                log.trace({img: img}, 'image copy result');

                if (opts.json) {
                    console.log(JSON.stringify(img));
                } else {
                    console.log('Copied image %s to datacenter %s',
                        common.imageRepr(img), args[1]);
                }

                next();
            });
        }
    ]}, function (err) {
        cb(err);
    });
}

do_copy.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: 'Other options'
    },
    {
        names: ['dry-run'],
        type: 'bool',
        help: 'Go through the motions without actually copying.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_copy.synopses = [
    '{{name}} {{cmd}} [OPTIONS] IMAGE DATACENTER'
];

do_copy.help = [
    /* BEGIN JSSTYLED */
    'Copy image to another datacenter.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).',
    '',
    '"DATACENTER" is the datacenter name (string). Use `triton datacenters` to',
    'show the available datacenter names.'
    /* END JSSTYLED */
].join('\n');

do_copy.aliases = ['cp'];

do_copy.completionArgtypes = ['tritonimage', 'tritondatacenter'];

module.exports = do_copy;
