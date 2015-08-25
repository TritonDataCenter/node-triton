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

    var columns = opts.o.trim().split(',');
    var sort = opts.s.trim().split(',');

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

    this.triton.cloudapi.listPackages(listOpts, function (err, packages) {
        if (opts.json) {
            console.log(common.jsonStream(packages));
        } else {
            tabula(packages, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                validFields: 'name,memory,disk,swap,vcpus,lwps,default,id,version'.split(',')
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
        names: ['H'],
        type: 'bool',
        help: 'Omit table header row.'
    },
    {
        names: ['o'],
        type: 'string',
        default: 'id,name,version,memory,disk',
        help: 'Specify fields (columns) to output.',
        helpArg: 'field1,...'
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
