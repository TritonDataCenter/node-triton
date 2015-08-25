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

    var getOpts = {
        id: args[0]
    };
    this.triton.cloudapi.getImage(getOpts, function onRes(err, img) {
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
    'Note: Currently this dumps prettified JSON by default. That might change\n' +
    'in the future. Use "-j" to explicitly get JSON output.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} image [<options>] ID\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);

do_image.aliases = ['img'];

module.exports = do_image;
