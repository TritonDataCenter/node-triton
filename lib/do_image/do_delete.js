/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton image delete ...`
 */

var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_delete(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length < 1) {
        return cb(new errors.UsageError('missing IMAGE arg(s)'));
    }
    var ids = args;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        /*
         * Lookup images, if not given UUIDs: we'll need to do it anyway
         * for the DeleteImage call(s), and doing so explicitly here allows
         * us to emit better output.
         */
        function getImgs(ctx, next) {
            ctx.imgFromId = {};
            ctx.missingIds = [];
            // TODO: this should have a concurrency
            vasync.forEachParallel({
                inputs: ids,
                func: function getImg(id, nextImg) {
                    if (common.isUUID(id)) {
                        // TODO: get info from cache if we have it
                        ctx.imgFromId[id] = {
                            id: id,
                            _repr: id
                        };
                        nextImg();
                        return;
                    }
                    // TODO: allow use of cache here
                    self.top.tritonapi.getImage(id, function (err, img) {
                        if (err) {
                            if (err.statusCode === 404) {
                                ctx.missingIds.push(id);
                                nextImg();
                            } else {
                                nextImg(err);
                            }
                        } else {
                            ctx.imgFromId[img.id] = img;
                            img._repr = format('%s (%s@%s)', img.id,
                                img.name, img.version);
                            nextImg();
                        }
                    });
                }
            }, next);
        },

        function errOnMissingIds(ctx, next) {
            if (ctx.missingIds.length === 1) {
                next(new errors.TritonError('no such image: '
                    + ctx.missingIds[0]));
            } else if (ctx.missingIds.length > 1) {
                next(new errors.TritonError('no such images: '
                    + ctx.missingIds.join(', ')));
            } else {
                next();
            }
        },

        function confirm(ctx, next) {
            if (opts.force) {
                next();
                return;
            }

            var keys = Object.keys(ctx.imgFromId);
            var msg;
            if (keys.length === 1) {
                msg = format('Delete image %s? [y/n] ',
                    ctx.imgFromId[keys[0]]._repr);
            } else {
                msg = format('Delete %d images? [y/n] ', keys.length);
            }

            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },

        function deleteThem(ctx, next) {
            // TODO: forEachParallel with concurrency
            vasync.forEachPipeline({
                inputs: Object.keys(ctx.imgFromId),
                func: function deleteOne(id, nextOne) {
                    self.top.tritonapi.cloudapi.deleteImage(id, function (err) {
                        if (!err) {
                            console.log('Deleted image %s',
                                ctx.imgFromId[id]._repr);
                        }
                        nextOne(err);
                    });
                }
            }, next);
        }
    ]}, function (err) {
        cb(err);
    });
}

do_delete.synopses = ['{{name}} {{cmd}} [OPTIONS] IMAGE [IMAGE ...]'];

do_delete.help = [
    /* BEGIN JSSTYLED */
    'Delete one or more images.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).'
    /* END JSSTYLED */
].join('\n');

do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Skip confirmation of delete.'
    }
];

do_delete.completionArgtypes = ['tritonimage'];

do_delete.aliases = ['rm'];
module.exports = do_delete;
