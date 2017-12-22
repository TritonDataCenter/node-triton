/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network ip list ...`
 */

var format = require('util').format;

var assert = require('assert-plus');
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


// columns default without -o
var columnsDefault = 'ip,managed,reserved,owner_uuid,belongs_to_uuid';

// sort default with -s
var sortDefault = 'ip';

function do_list(subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 1) {
        return callback(new errors.UsageError(format(
            'incorrect number of args (%d)', args.length)));
    }

    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    }
    columns = columns.split(',');

    var sort = opts.s.split(',').map(function mapSort(field) {
        var so = {};

        field = field.trim();
        assert.ok(field, 'non-empty field');

        if (field[0] === '-') {
            so.field = field.slice(1);
            so.reverse = true;
        } else {
            so.field = field;
        }

        switch (so.field) {
        case 'ip':
            so.keyFunc = common.ipv4ToLong;
            break;
        default:
            break;
        }

        return so;
    });

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        function listIps(arg, next) {
            self.top.tritonapi.listNetworkIps(args[0],
                function (err, ips, res) {
                 if (err) {
                     next(err);
                     return;
                 }
                 arg.ips = ips;
                 next();
            });
        },

       function doneIps(arg, next) {
            var ips = arg.ips;
            if (opts.json) {
                common.jsonStream(ips);
            } else {
                tabula(ips, {
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

do_list.synopses = ['{{name}} {{cmd}} NETWORK'];

do_list.help = [
    'List network IPs.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Fields (most are self explanatory, the significant ones are as follows):',
    '    managed      IP is manged by Triton and cannot be modified directly.',
    '',
    'See https://apidocs.joyent.com/cloudapi/#ListNetworkIPs for a full' +
        ' listing.'
].join('\n');

do_list.aliases = ['ls'];
do_list.completionArgtypes = ['tritonnetwork', 'none'];

module.exports = do_list;
