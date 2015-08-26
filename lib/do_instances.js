/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton instances ...`
 */

var tabula = require('tabula');

var common = require('./common');

// to be passed as query string args to /my/machines
var validFilters = [
    'name',
    'image',
    'state',
    'memory',
    'tombstone',
    'credentials'
];

// valid output fields to be printed
var validFields = [
    'id',
    'name',
    'type',
    'state',
    'dataset',
    'memory',
    'disk',
    'ips',
    'metadata',
    'created',
    'updated',
    'package',
    'image',
    'ago'
];

function do_instances(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        callback(new Error('too many args: ' + args));
        return;
    }

    var columns = opts.o.trim().split(',');
    var sort = opts.s.trim().split(',');

    var listOpts;
    try {
        listOpts = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }

    this.triton.cloudapi.listMachines(listOpts, function (err, machines) {
        if (err) {
            callback(err);
            return;
        }

        // add extra fields for nice output
        var now = new Date();
        machines.forEach(function (machine) {
            var created = new Date(machine.created);
            machine.ago = common.longAgo(created, now);
        });

        if (opts.json) {
            console.log(common.jsonStream(machines));
        } else {
            tabula(machines, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                validFields: validFields
            });
        }
        callback();
    });
}

do_instances.options = [
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
        default: 'id,name,state,type,image,memory,disk,ago',
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
do_instances.help = (
    'List instances.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} instances [<filters>...]\n'
    + '\n'
    + '{{options}}'
);

do_instances.aliases = ['insts'];

module.exports = do_instances;
