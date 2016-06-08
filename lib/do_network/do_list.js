/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton network list ...`
 */

var tabula = require('tabula');

var common = require('../common');

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

function do_list(subcmd, opts, args, callback) {
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

    this.top.tritonapi.cloudapi.listNetworks(function (err, networks) {
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

do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_list.synopses = ['{{name}} {{cmd}}'];

do_list.help = [
    'List available networks.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Fields (most are self explanatory, the client adds some for convenience):',
    '    vlan       A shorter alias for "vlan_id".',
    '    shortid    A short ID prefix.'
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
