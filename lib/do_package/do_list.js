/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton package list ...`
 */

var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');


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
var columnsDefault = 'shortid,name,memory,swap,disk,vcpus';

// columns default with -l
var columnsDefaultLong = 'id,name,memory,swap,disk,vcpus,description';

// sort default with -s
var sortDefault = '_groupPlus,memory';

function do_list(subcmd, opts, args, callback) {
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

    var context = {
        cli: this.top
    };
    vasync.pipeline({arg: context, funcs: [
        common.cliSetupTritonApi,

        function getThem(arg, next) {
            arg.cli.tritonapi.cloudapi.listPackages(listOpts,
                function (err, pkgs) {
                    if (err) {
                        next(err);
                        return;
                    }
                    arg.pkgs = pkgs;
                    next();
                }
            );
        },

        function display(arg, next) {
            if (opts.json) {
                common.jsonStream(arg.pkgs);
            } else {
                for (i = 0; i < arg.pkgs.length; i++) {
                    var pkg = arg.pkgs[i];
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
                tabula(arg.pkgs, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort
                });
            }
            next();
        }
    ]}, callback);
}

do_list.options = [
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

do_list.synopses = ['{{name}} {{cmd}} [FILTERS]'];
do_list.help = [
    /* BEGIN JSSTYLED */
    'List packages.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Filters:',
    '    FIELD=VALUE        Field equality filter. Supported fields: ',
    '                       account, owner, state, name, os, and type.',
    '    FIELD=true|false   Field boolean filter. Supported fields: public.',
    '    FIELD=~SUBSTRING   Field substring filter. Supported fields: name',
    '',
    'Notes on some fields:',
    '- The "memory" (a.k.a. RAM), "swap", and "disk" fields are shown in',
    '  more human readable units in tabular output (i.e. if neither "-p" nor',
    '  "-j" is specified.',
    '- The "vcpus" field is only relevant for KVM instances. It is therefore',
    '  typically set to zero for packages not intended for KVM usage. This',
    '  zero is shown as "-" in tabular output.',
    '',
    'Examples:',
    '    {{name}} list memory=8192   # list packages with 8G RAM'
    /* END JSSTYLED */
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
