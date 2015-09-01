/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton package ...`
 */

var format = require('util').format;

var errors = require('./errors');


function do_package(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        return callback(new errors.UsageError(format(
            'incorrect number of args (%d): %s', args.length, args.join(' '))));
    }

    this.triton.getPackage(args[0], function onRes(err, pkg) {
        if (err) {
            return callback(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(pkg));
        } else {
            console.log(JSON.stringify(pkg, null, 4));
        }
        callback();
    });
}

do_package.options = [
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
do_package.help = (
    /* BEGIN JSSTYLED */
    'Get a package.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} package [<options>] ID|NAME\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'The given "NAME" must be a unique match.\n' +
    '\n' +
    'Note: Currently this dumps prettified JSON by default. That might change\n' +
    'in the future. Use "-j" to explicitly get JSON output.\n'
    /* END JSSTYLED */
);

do_package.aliases = ['pkg'];

module.exports = do_package;
