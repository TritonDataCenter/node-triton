/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton image list ...`
 */

var format = require('util').format;
var tabula = require('tabula');

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
        listOpts = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }
    if (opts.all) {
        listOpts.state = 'all';
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        tritonapi.listImages(listOpts, function onRes(err, imgs, res) {
            if (err) {
                return callback(err);
            }

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
                    img.flags = flags.length ? flags.join('') : undefined;
                }

                tabula(imgs, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort
                });
            }
            callback();
        });
    });
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
