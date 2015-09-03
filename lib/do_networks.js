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

// columns default without -o
var columnsDefault = 'shortid,name,subnet,gateway,fabric,vlan,public';

// columns default with -l
var columnsDefaultLong = 'id,name,subnet,gateway,fabric,vlan,public';

// sort default with -s
var sortDefault = 'name';

function do_networks(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = columnsDefaultLong;
    }
    columns = columns.split(',');

    var sort = opts.s.split(',');

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
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

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
