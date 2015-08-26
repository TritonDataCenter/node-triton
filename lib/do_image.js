/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton image ...`
 */

var format = require('util').format;

var errors = require('./errors');


function do_image(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        return callback(new errors.UsageError(format(
            'incorrect number of args (%d): %s', args.length, args.join(' '))));
    }

    this.triton.getImage(args[0], function onRes(err, img) {
        if (err) {
            return callback(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(img));
        } else {
            console.log(JSON.stringify(img, null, 4));
        }
        callback();
    });
};

do_image.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];
do_image.help = (
    /* BEGIN JSSTYLED */
    'Get an image.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} image [<options>] ID|NAME\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'If there are more than one image with the given "NAME", the latest\n' +
    'image (by "published_at") is returned.\n' +
    '\n' +
    'Note: Currently this dumps prettified JSON by default. That might change\n' +
    'in the future. Use "-j" to explicitly get JSON output.\n'
    /* END JSSTYLED */
);

do_image.aliases = ['img'];

module.exports = do_image;
