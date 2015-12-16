/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton packages ...`
 */

var tabula = require('tabula');

var common = require('./common');

// valid filters to pass to cloudapi.listPackages
var validFilters = [
    'name',
    'memory',
    'disk',
    'swap',
    'lwps',
    'version',
    'vcpus',
    'group'
];

// columns default without -o
var columnsDefault = 'shortid,name,default,memory,swap,disk,vcpus';

// columns default with -l
var columnsDefaultLong = 'id,name,default,memory,swap,disk,vcpus';

// sort default with -s
var sortDefault = '_groupPlus,memory';

function do_packages(subcmd, opts, args, callback) {
    var i;
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
    var rightAligned = {memory: true, disk: true, swap: true,
            vcpus: true, lwps: true};
    for (i = 0; i < columns.length; i++) {
        if (rightAligned[columns[i]]) {
            columns[i] = {lookup: columns[i], align: 'right'};
        }
    }

    var sort = opts.s.split(',');

    var listOpts;
    try {
        listOpts = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }

    this.tritonapi.cloudapi.listPackages(listOpts, function (err, pkgs) {
        if (err) {
            callback(err);
            return;
        }
        if (opts.json) {
            common.jsonStream(pkgs);
        } else {
            for (i = 0; i < pkgs.length; i++) {
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
                    pkg.vcpusHuman = pkg.vcpus === 0 ? '-' : pkg.vcpus;
                }
            }
            if (!opts.p) {
                columns = columns.map(function (c) {
                    switch (c.lookup || c) {
                    case 'memory':
                        return {lookup: 'memoryHuman', name: 'MEMORY',
                            align: 'right'};
                    case 'swap':
                        return {lookup: 'swapHuman', name: 'SWAP',
                            align: 'right'};
                    case 'disk':
                        return {lookup: 'diskHuman', name: 'DISK',
                            align: 'right'};
                    case 'vcpus':
                        return {lookup: 'vcpusHuman', name: 'VCPUS',
                            align: 'right'};
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
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
})).concat([
    {
        names: ['p'],
        type: 'bool',
        help: 'Display numbers in parsable (exact) values.'
    }
]);

do_packages.help = (
    /* BEGIN JSSTYLED */
    'List packgaes.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} packages\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Notes on some fields:\n'
    + '- The "memory" (a.k.a. RAM), "swap", and "disk" fields are shown in\n'
    + '  more human readable units in tabular output (i.e. if neither "-p" nor\n'
    + '  "-j" is specified.\n'
    + '- The "vcpus" field is only relevant for KVM instances. It is therefore\n'
    + '  typically set to zero for packages not intended for KVM usage. This\n'
    + '  zero is shown as "-" in tabular output.\n'
    /* END JSSTYLED */
);

do_packages.aliases = ['pkgs'];

module.exports = do_packages;
