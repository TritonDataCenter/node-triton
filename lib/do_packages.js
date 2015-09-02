/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton packages ...`
 */

var tabula = require('tabula');

var common = require('./common');

function do_packages(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var columns = 'shortid,name,default,memory,swap,disk'.split(',');
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
            common.jsonStream(pkgs);
        } else {
            for (var i = 0; i < pkgs.length; i++) {
                var pkg = pkgs[i];
                pkg.shortid = pkg.id.split('-', 1)[0];

                /*
                 * We take a slightly "smarter" view of "group" for default
                 * sorting, to accomodate usage in the JPC. More recent
                 * common usage is for packages to have "foo-*" naming.
                 * JPC includes package sets of yore *and* recent that don't
                 * use the "group" field. We secondarily separate those
                 * on a possible "foo-" prefix.
                 */
                pkg._groupPlus = (pkg.group || (pkg.name.indexOf('-') === -1
                    ? '' : pkg.name.split('-', 1)[0]));

                if (!opts.p) {
                    pkg.memoryHuman = common.humanSizeFromBytes({
                        precision: 1,
                        narrow: true
                    }, pkg.memory * 1024 * 1024);
                    pkg.swapHuman = common.humanSizeFromBytes({
                        precision: 1,
                        narrow: true
                    }, pkg.swap * 1024 * 1024);
                    pkg.diskHuman = common.humanSizeFromBytes({
                        precision: 1,
                        narrow: true
                    }, pkg.disk * 1024 * 1024);
                }
            }
            if (!opts.p) {
                columns = columns.map(function (c) {
                    switch (c) {
                    case 'memory':
                        return {lookup: 'memoryHuman', name: 'MEMORY'};
                    case 'swap':
                        return {lookup: 'swapHuman', name: 'SWAP'};
                    case 'disk':
                        return {lookup: 'diskHuman', name: 'DISK'};
                    default:
                        return c;
                    }
                });
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
        default: '_groupPlus,memory',
        help: 'Sort on the given fields. Default is "group,memory".',
        helpArg: 'field1,...'
    },
    {
        names: ['p'],
        type: 'bool',
        help: 'Display numbers in parsable (exact) values.'
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
