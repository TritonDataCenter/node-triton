/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 *
 * `triton image list ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');

// filters to pass triton.listImages
var validFilters = [
    'name',
    'os',
    'version',
    'public',
    'state',
    'owner',
    'type'
];

// columns default without -o
var columnsDefault = 'shortid,name,version,flags,os,type,pubdate';

// columns default with -l
var columnsDefaultLong = 'id,name,version,state,flags,os,type,pubdate';

// sort default with -s
var sortDefault = 'published_at';

function do_list(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = columnsDefaultLong;
    }
    columns = columns.split(',');

    var sort = opts.s.split(',');

    var listOpts;
    try {
        listOpts = common.objFromKeyValueArgs(args, {
            disableDotted: true,
            validKeys: validFilters,
            disableTypeConversions: true
        });
    } catch (e) {
        callback(e);
        return;
    }
    if (opts.all) {
        listOpts.state = 'all';
    }

    var self = this;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({ arg: {}, funcs: [
        function setupTritonApi(_, next) {
            common.cliSetupTritonApi({cli: self.top}, next);
        },
        function getImages(ctx, next) {
            tritonapi.listImages(listOpts, function onRes(err, imgs, res) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.imgs = imgs;
                next();
            });
        },
        function getUserAccount(ctx, next) {
            // If using json output, or when there are no images that use an ACL
            // - we don't need to fetch the account, as the account is only used
            // to check if the image is shared (i.e. the account is in the image
            // ACL) so it can output image flags in non-json mode.
            if (opts.json || ctx.imgs.every(function _checkAcl(img) {
                return !Array.isArray(img.acl) || img.acl.length === 0;
            })) {
                next();
                return;
            }
            tritonapi.cloudapi.getAccount(function _accountCb(err, account) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.account = account;
                next();
            });
        },
        function formatImages(ctx, next) {
            var imgs = ctx.imgs;
            if (opts.json) {
                common.jsonStream(imgs);
            } else {
                // Add some convenience fields
                // Added fields taken from imgapi-cli.git.
                for (var i = 0; i < imgs.length; i++) {
                    var img = imgs[i];
                    img.shortid = img.id.split('-', 1)[0];
                    if (img.published_at) {
                        // Just the date.
                        img.pubdate = img.published_at.slice(0, 10);
                        // Normalize on no milliseconds.
                        img.pub = img.published_at.replace(/\.\d+Z$/, 'Z');
                    }
                    if (img.files && img.files[0]) {
                        img.size = img.files[0].size;
                    }
                    var flags = [];
                    if (img.origin) flags.push('I');
                    if (img['public']) flags.push('P');
                    if (img.state !== 'active') flags.push('X');

                    // Add image sharing flags.
                    if (Array.isArray(img.acl) && img.acl.length > 0) {
                        assert.string(ctx.account, 'ctx.account');
                        if (img.owner === ctx.account.id) {
                            // This image has been shared with other accounts.
                            flags.push('+');
                        }
                        if (img.acl.indexOf(ctx.account.id) !== -1) {
                            // This image has been shared with this account.
                            flags.push('S');
                        }
                    }

                    img.flags = flags.length ? flags.join('') : undefined;
                }

                tabula(imgs, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort
                });
            }
            next();
        }
    ]}, callback);
}

do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: 'Filtering options'
    },
    {
        names: ['all', 'a'],
        type: 'bool',
        help: 'List all images, not just "active" ones. This ' +
            'is a shortcut for the "state=all" filter.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] [FILTERS]'];

do_list.help = [
    /* BEGIN JSSTYLED */
    'List images.',
    '',
    'Note: Currently, *docker* images are not included in this endpoint\'s responses.',
    'You must use `docker images` against the Docker service for this data center.',
    'See <https://apidocs.joyent.com/docker>.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Filters:',
    '    FIELD=VALUE        Equality filter. Supported fields: account, owner,',
    '                       state, name, os, and type.',
    '    FIELD=true|false   Boolean filter. Supported fields: public.',
    '    FIELD=~SUBSTRING   Substring filter. Supported fields: name',
    '',
    'Fields (most are self explanatory, "*" indicates a field added client-side',
    'for convenience):',
    '    shortid*           A short ID prefix.',
    '    flags*             Single letter flags summarizing some fields:',
    '                           "P" image is public',
    '                           "+" you are sharing this image with others',
    '                           "S" this image has been shared with you',
    '                           "I" an incremental image (i.e. has an origin)',
    '                           "X" has a state *other* than "active"',
    '    pubdate*           Short form of "published_at" with just the date',
    '    pub*               Short form of "published_at" elliding milliseconds.',
    '    size*              The number of bytes of the image file (files.0.size)',
    '    type               The image type. As of CloudAPI 8.0 this is defined by',
    '                       <https://images.joyent.com/docs/#manifest-type>. Before',
    '                       that it was one of "smartmachine" or "virtualmachine".'
    /* END JSSTYLED */
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
