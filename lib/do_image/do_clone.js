/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 *
 * `triton image clone ...`
 */

var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');

// ---- the command

function do_clone(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        cb(new errors.UsageError(
            'incorrect number of args: expected 1, got ' + args.length));
        return;
    }

    var log = this.top.log;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function cloneImage(ctx, next) {
            log.trace({dryRun: opts.dry_run, account: ctx.account},
                'image clone account');

            if (opts.dry_run) {
                next();
                return;
            }

            tritonapi.cloneImage({image: args[0]}, function _cloneCb(err, img) {
                if (err) {
                    next(new errors.TritonError(err, 'error cloning image'));
                    return;
                }

                log.trace({img: img}, 'image clone result');

                if (opts.json) {
                    console.log(JSON.stringify(img));
                } else {
                    console.log('Cloned image %s to %s',
                        args[0], common.imageRepr(img));
                }

                next();
            });
        }
    ]}, cb);
}

do_clone.options = [
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
        help: 'Go through the motions without actually cloning.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_clone.synopses = [
    '{{name}} {{cmd}} [OPTIONS] IMAGE'
];

do_clone.help = [
    /* BEGIN JSSTYLED */
    'Clone a shared image.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).',
    '',
    'Note: Only shared images can be cloned.'
    /* END JSSTYLED */
].join('\n');

do_clone.completionArgtypes = ['tritonimage', 'none'];

module.exports = do_clone;
