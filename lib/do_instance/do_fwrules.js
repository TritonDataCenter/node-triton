/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance fwrules ...`
 */

var assert = require('assert-plus');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');


var COLUMNS_DEFAULT = 'shortid,enabled,global,rule';
var COLUMNS_LONG = 'id,enabled,global,rule,description';
var SORT_DEFAULT = 'rule';


function do_fwrules(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing <inst> argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];

    var cli = this.top;
    cli.tritonapi.listInstanceFirewallRules({
        id: id
    }, function onRules(err, rules) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(rules);
        } else {
            var columns = COLUMNS_DEFAULT;

            if (opts.o) {
                columns = opts.o;
            } else if (opts.long) {
                columns = COLUMNS_LONG;
            }

            columns = columns.toLowerCase().split(',');
            var sort = opts.s.toLowerCase().split(',');

            if (columns.indexOf('shortid') !== -1) {
                rules.forEach(function (rule) {
                    rule.shortid = common.normShortId(rule.id);
                });
            }

            tabula(rules, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
            });
        }
        cb();
    });
}


do_fwrules.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: SORT_DEFAULT
}));

do_fwrules.help = [
    'Show firewall rules applied to an instance.',
    '',
    'Usage:',
    '     {{name}} fwrules [<options>] <inst>',
    '',
    '{{options}}'
].join('\n');

do_fwrules.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_fwrules;
