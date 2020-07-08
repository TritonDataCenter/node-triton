/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton image tag ...`
 */

var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var mat = require('../metadataandtags');

// ---- the command

function do_tag(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    }

    var log = this.top.log;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        function gatherTags(ctx, next) {
            mat.tagsFromSetArgs(opts, args.slice(1), log, function (err, tags) {
                if (err) {
                    next(err);
                    return;
                }
                log.trace({tags: tags || '<none>'},
                    'tags loaded from opts and args');
                if (!tags) {
                    next(new errors.UsageError('Incorrect number of args: ' +
                        'must specify at least one NAME=VALUE tag pair'));
                    return;
                }
                ctx.tags = tags;
                next();
            });
        },
        function updateImageTags(ctx, next) {
            log.trace({dryRun: opts.dry_run, tags: ctx.tags},
                'image tag');

            if (opts.dry_run) {
                next();
                return;
            }

            tritonapi.updateImage({
                image: args[0],
                fields: {
                    tags: ctx.tags
                }
            }, function (err, img) {
                if (err) {
                    next(new errors.TritonError(err,
                        'error updating image tags'));
                    return;
                }

                log.trace({img: img}, 'image update tags result');

                if (opts.json) {
                    console.log(JSON.stringify(img));
                } else {
                    console.log('Updated image %s with tags %j',
                        args[0], ctx.tags);
                }

                next();
            });
        }
    ]}, cb);
}

do_tag.options = [
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

do_tag.synopses = [
    '{{name}} {{cmd}} [OPTIONS] IMAGE [NAME=VALUE ...]'
];

do_tag.help = [
    /* eslint-disable max-len */
    /* BEGIN JSSTYLED */
    'Set new image tags, removes existing tags.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).',
    '',
    'NAME is a tag name. VALUE is a tag value.',
    '',
    'Note: Only images that are owned by the account can be tagged.'
    /* END JSSTYLED */
    /* eslint-enable max-len */
].join('\n');

do_tag.completionArgtypes = ['tritonimage', 'none'];

module.exports = do_tag;
