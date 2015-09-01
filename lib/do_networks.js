/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton networks ...`
 */

var tabula = require('tabula');

var common = require('./common');

// to be passed as query string args to /my/networks
var validFilters = [
    'id',
    'name',
    'public',
    'description'
];

// valid output fields to be printed
var validFields = [
    'id',
    'name',
    'public',
    'fabric',
    'gateway',
    'internet_nat',
    'provision_end_ip',
    'provision_start_ip',
    'resolvers',
    'subnet',
    'vlan_id'
];

function do_networks(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var columns = opts.o.trim().split(',');
    var sort = opts.s.trim().split(',');

    /* not supported
    var listOpts;
    try {
        listOpts = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }
    */

    this.triton.cloudapi.listNetworks(function (err, networks) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(networks);
        } else {
            // pretty print
            tabula(networks, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                validFields: validFields
            });
        }
        callback();
    });
}

do_networks.options = [
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
        default: 'id,name,subnet,public,vlan_id,gateway',
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
do_networks.help = (
    'List available networks.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} networks\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_networks;
