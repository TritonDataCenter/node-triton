/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton packages ...`
 */

var tabula = require('tabula');

var common = require('./common');

function do_packages (subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        callback(new Error('too many args: ' + args));
        return;
    }

    var columns = 'shortid,name,default,memory,disk'.split(',');
    if (opts.o) {
        /* JSSTYLED */
        columns = opts.o.trim().split(/\s*,\s*/g);
    } else if (opts.long) {
        columns[0] = 'id';
    }
    /* JSSTYLED */
    var sort = opts.s.trim().split(/\s*,\s*/g);

    var validFilters = [
        'name', 'memory', 'disk', 'swap', 'lwps', 'version', 'vcpus', 'group'
    ];
    var listOpts;
    try {
        listOpts = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }

    this.triton.cloudapi.listPackages(listOpts, function (err, pkgs) {
        if (err) {
            callback(err);
            return;
        }
        if (opts.json) {
            console.log(common.jsonStream(pkgs));
        } else {
            for (var i = 0; i < pkgs.length; i++) {
                var pkg = pkgs[i];
                pkg.shortid = pkg.id.split('-', 1)[0];
            }
            tabula(pkgs, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
            });
        }
        callback();
    });
}

do_packages.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
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
        help: 'Specify fields (columns) to output.',
        helpArg: 'field1,...'
    },
    {
        names: ['long', 'l'],
        type: 'bool',
        help: 'Long/wider output. Ignored if "-o ..." is used.'
    },
    {
        names: ['s'],
        type: 'string',
        default: 'name',
        help: 'Sort on the given fields. Default is "name".',
        helpArg: 'field1,...'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];
do_packages.help = (
    'List packgaes.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} packages\n'
    + '\n'
    + '{{options}}'
);

do_packages.aliases = ['pkgs'];

module.exports = do_packages;
