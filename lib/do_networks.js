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

function do_networks(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var columns = 'shortid,name,subnet,gateway,fabric,vlan,public'.split(',');
    if (opts.o) {
        /* JSSTYLED */
        columns = opts.o.trim().split(/\s*,\s*/g);
    } else if (opts.long) {
        columns[0] = 'id';
    }
    var sort = opts.s.trim().split(',');

    this.triton.cloudapi.listNetworks(function (err, networks) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(networks);
        } else {
            for (var i = 0; i < networks.length; i++) {
                var net = networks[i];
                net.shortid = net.id.split('-', 1)[0];
                net.vlan = net.vlan_id;
            }
            tabula(networks, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
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
do_networks.help = [
    'List available networks.',
    '',
    'Usage:',
    '     {{name}} networks',
    '',
    'Fields (most are self explanatory, the client adds some for convenience):',
    '    vlan       A shorter alias for "vlan_id".',
    '    shortid    A short ID prefix.',
    '',
    '{{options}}'
].join('\n');

module.exports = do_networks;
