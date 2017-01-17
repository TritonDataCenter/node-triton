/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network list ...`
 */

var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


var validFilters = [
    'public'
];

// columns default without -o
var columnsDefault = 'shortid,name,subnet,gateway,fabric,vlan,public';

// columns default with -l
var columnsDefaultLong = 'id,name,subnet,gateway,fabric,vlan,public';

// sort default with -s
var sortDefault = 'name';

function do_list(subcmd, opts, args, callback) {
    var self = this;
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

    var sort = opts.s.split(',');
    var filters;
    try {
        filters = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }
    if (filters.hasOwnProperty('public')) {
        filters.public =
            common.boolFromString(filters.public, null, 'public');
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        function searchNetworks(arg, next) {
            self.top.tritonapi.cloudapi.listNetworks(function (err, networks) {
                 if (err) {
                     next(err);
                     return;
                 }
                 arg.networks = networks;
                 next();
            });
        },

        function filterNetworks(arg, next) {
            var filteredNetworks = [];
            var filterKeys = Object.keys(filters);
            for (var i = 0; i < arg.networks.length; i++) {
                var network = arg.networks[i];
                var keepIt = true;
                for (var j = 0; j < filterKeys.length; j++) {
                    var k = filterKeys[j];
                    if (network[k] !== filters[k]) {
                        keepIt = false;
                        break;
                    }
                }
                if (keepIt) {
                    filteredNetworks.push(network);
                }
            }
            arg.filteredNetworks = filteredNetworks;
            next();
       },

       function doneNetworks(arg, next) {
            var networks = arg.filteredNetworks;
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
}));

do_list.synopses = ['{{name}} {{cmd}} [FILTERS...]'];

do_list.help = [
    'List available networks.',
    '',
    '{{usage}}',
    '',
    'Filters:',
    '    FIELD=true|false   Boolean filter. Supported fields: public',
    '',
    '{{options}}',
    'Fields (most are self explanatory, the client adds some for convenience):',
    '    vlan       A shorter alias for "vlan_id".',
    '    shortid    A short ID prefix.'
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
