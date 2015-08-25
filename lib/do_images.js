/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton images ...`
 */

var format = require('util').format;
var tabula = require('tabula');

var errors = require('./errors');


function do_images(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    /* JSSTYLED */
    var columns = opts.o.trim().split(/\s*,\s*/g);
    /* JSSTYLED */
    var sort = opts.s.trim().split(/\s*,\s*/g);

    var listOpts = {};
    var validFilters = [
        'name', 'os', 'version', 'public', 'state', 'owner', 'type'
    ];
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        var idx = arg.indexOf('=');
        if (idx === -1) {
            return callback(new errors.UsageError(format(
                'invalid filter: "%s" (must be of the form "field=value")',
                arg)));
        }
        var k = arg.slice(0, idx);
        var v = arg.slice(idx + 1);
        if (validFilters.indexOf(k) === -1) {
            return callback(new errors.UsageError(format(
                'invalid filter name: "%s" (must be one of "%s")',
                k, validFilters.join('", "'))));
        }
        listOpts[k] = v;
    }
    if (opts.all) {
        listOpts.state = 'all';
    }

    this.triton.cloudapi.listImages(listOpts, function onRes(err, imgs, res) {
        if (err) {
            return callback(err);
        }

        if (opts.json) {
            // XXX we should have a common method for all these:
            //      XXX json stream
            //      XXX sorting
            //      XXX if opts.o is given, then filter to just those fields?
            for (var i = 0; i < imgs.length; i++) {
                console.log(JSON.stringify(imgs[i]));
            }
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
};

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
    },
    {
        group: 'Output options'
    },
    {
        names: ['H'],
        type: 'bool',
        help: 'Omit table header row.'
    },
    {
        names: ['o'],
        type: 'string',
        default: 'id,name,version,state,flags,os,pubdate',
        help: 'Specify fields (columns) to output.',
        helpArg: 'field1,...'
    },
    {
        names: ['s'],
        type: 'string',
        default: 'published_at',
        help: 'Sort on the given fields. Default is "published_at".',
        helpArg: 'field1,...'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];
do_images.help = (
    'List images.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} images\n'
    + '\n'
    + '{{options}}'
);
do_images.help = (
    /* BEGIN JSSTYLED */
    'List images.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} list [<options>] [<filters>]\n' +
    '\n' +
    'Filters:\n' +
    '    FIELD=VALUE        Field equality filter. Supported fields: \n' +
    '                       account, owner, state, name, os, and type.\n' +
    '    FIELD=true|false   Field boolean filter. Supported fields: public.\n' +
    '    FIELD=~SUBSTRING   Field substring filter. Supported fields: name\n' +
    '\n' +
    'Fields (most are self explanatory, the client adds some for convenience):\n' +
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

module.exports = do_images;
