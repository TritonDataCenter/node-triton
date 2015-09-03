/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton images ...`
 */

var format = require('util').format;
var tabula = require('tabula');

var common = require('./common');
var errors = require('./errors');

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
var columnsDefault = 'shortid,name,version,state,flags,os,pubdate';

// columns default with -l
var columnsDefaultLong = 'id,name,version,state,flags,os,pubdate';

// sort default with -s
var sortDefault = 'published_at';

function do_images(subcmd, opts, args, callback) {
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

    this.triton.listImages(listOpts, function onRes(err, imgs, res) {
        if (err) {
            return callback(err);
        }

        if (opts.json) {
            // XXX we should have a common method for all these:
            //      XXX sorting
            //      XXX if opts.o is given, then filter to just those fields?
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
}

do_images.options = [
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

do_images.help = (
    /* BEGIN JSSTYLED */
    'List images.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} images [<options>] [<filters>]\n' +
    '\n' +
    'Filters:\n' +
    '    FIELD=VALUE        Field equality filter. Supported fields: \n' +
    '                       account, owner, state, name, os, and type.\n' +
    '    FIELD=true|false   Field boolean filter. Supported fields: public.\n' +
    '    FIELD=~SUBSTRING   Field substring filter. Supported fields: name\n' +
    '\n' +
    'Fields (most are self explanatory, the client adds some for convenience):\n' +
    '    shortid            A short ID prefix.\n' +
    '    flags              This is a set of single letter flags\n' +
    '                       summarizing some fields. "P" indicates the\n' +
    '                       image is public. "I" indicates an incremental\n' +
    '                       image (i.e. has an origin). "X" indicates an\n' +
    '                       image with a state *other* than "active".\n' +
    '    pubdate            Short form of "published_at" with just the date\n' +
    '    pub                Short form of "published_at" elliding milliseconds.\n' +
    '    size               The number of bytes of the image file (files.0.size)\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);

do_images.aliases = ['imgs'];

module.exports = do_images;
