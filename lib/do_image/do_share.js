/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 *
 * `triton image share ...`
 */

var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');

// ---- the command

function do_share(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        cb(new errors.UsageError(
            'incorrect number of args: expect 2, got ' + args.length));
        return;
    }

    var log = this.top.log;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function shareImage(ctx, next) {
            log.trace({dryRun: opts.dry_run, account: ctx.account},
                'image share account');

            if (opts.dry_run) {
                next();
                return;
            }

            tritonapi.shareImage({
                image: args[0],
                account: args[1]
            }, function (err, img) {
                if (err) {
                    next(new errors.TritonError(err, 'error sharing image'));
                    return;
                }

                log.trace({img: img}, 'image share result');

                if (opts.json) {
                    console.log(JSON.stringify(img));
                } else {
                    console.log('Shared image %s with account %s',
                        args[0], args[1]);
                }

                next();
            });
        }
    ]}, function (err) {
        cb(err);
    });
}

do_share.options = [
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
        help: 'Go through the motions without actually sharing.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_share.synopses = [
    '{{name}} {{cmd}} [OPTIONS] IMAGE ACCOUNT'
];

do_share.help = [
    /* BEGIN JSSTYLED */
    'Share an image with another account.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).',
    '',
    'Where "ACCOUNT" is the full account UUID.',
    '',
    'Note: Only images that are owned by the account can be shared.'
    /* END JSSTYLED */
].join('\n');

do_share.completionArgtypes = ['tritonimage', 'none'];

module.exports = do_share;
