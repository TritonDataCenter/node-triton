/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton image update ...`
 */

var jsprim = require('jsprim');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var UPDATE_IMAGE_FIELDS =
    require('../cloudapi2').CloudApi.prototype.UPDATE_IMAGE_FIELDS;
// Image ACLs should be modified using `triton image share|unshare`:
var updateImageFields = jsprim.deepCopy(UPDATE_IMAGE_FIELDS);
delete updateImageFields.acl;


function do_update(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    var tritonapi = this.top.tritonapi;
    var log = this.top.log;

    if (args.length === 0) {
        cb(new errors.UsageError('missing IMAGE argument'));
        return;
    }

    var image = args.shift();

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        function gatherDataArgs(ctx, next) {
            try {
                ctx.data = common.objFromKeyValueArgs(args, {
                    disableDotted: true,
                    typeHintFromKey: updateImageFields
                });
            } catch (err) {
                next(err);
                return;
            }

            next();
        },

        function validateIt(ctx, next) {
            try {
                common.validateObject(ctx.data, updateImageFields);
            } catch (e) {
                next(e);
                return;
            }

            next();
        },

        function updateAway(ctx, next) {
            log.trace({dryRun: opts.dry_run, fields: ctx.data},
                'image update');

            if (opts.dry_run) {
                next();
                return;
            }

            tritonapi.updateImage({
                image: image,
                fields: ctx.data
            }, function (err, img) {
                if (err) {
                    next(err);
                    return;
                }

                log.trace({img: img}, 'image update result');

                if (opts.json) {
                    console.log(JSON.stringify(img));
                } else {
                    console.log('Updated image %s (fields: %s)', image,
                            Object.keys(ctx.data).join(', '));
                }

                next();
            });
        }
    ]}, cb);
}

do_update.options = [
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

do_update.synopses = [
    '{{name}} {{cmd}} IMAGE [FIELD=VALUE ...]'
];
do_update.help = [
    /* eslint-disable max-len */
    /* BEGIN JSSTYLED */
    'Update an image',
    '',
    '{{usage}}',
    '',
    '{{options}}',

    'Updateable fields:',
    '    ' + Object.keys(updateImageFields).sort().map(function (f) {
        return f + ' (' + updateImageFields[f] + ')';
    }).join('\n    '),
    '',
    'Where "IMAGE" is an image id (a full UUID), an image name (selects the',
    'latest, by "published_at", image with that name), an image "name@version"',
    '(selects latest match by "published_at"), or an image short ID (ID prefix).',
    '',
    'Note: Only images that are owned by the account can be updated.'
].join('\n');
/* END JSSTYLED */
/* eslint-enable max-len */
do_update.completionArgtypes = ['tritonimage', 'tritonupdateimagefield'];

module.exports = do_update;
