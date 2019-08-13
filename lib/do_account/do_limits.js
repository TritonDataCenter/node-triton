/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 *
 * `triton account limits ...`
 */

var tabula = require('tabula');

var common = require('../common');


var COLUMNS = [
    { lookup: 'type', width: 9 },
    { lookup: 'used', align: 'right' },
    { lookup: 'limit', align: 'right' }
];
var COLUMNS_EXTRA = COLUMNS.concat([
    { lookup: 'os', width: 8 },
    { lookup: 'image' }
]);

function do_limits(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
            return;
        }
        tritonapi.cloudapi.getAccountLimits(function (err, limits) {
            if (err) {
                callback(err);
                return;
            }

            var columns = COLUMNS;
            var i;
            var limit;

            for (i = 0; i < limits.length; i++) {
                limit = limits[i];

                // Check if we need the extra column format.
                if (limit.check) {
                    columns = COLUMNS_EXTRA;
                }

                // Convert limit field names for readability.
                limit.limit = limit.value;
                limit.type = limit.by;
                delete limit.value;
                delete limit.by;
            }

            if (opts.json) {
                console.log(JSON.stringify(limits));
            } else {
                tabula(limits, {
                    skipHeader: opts.H,
                    columns: columns
                });
            }
            callback();
        });
    });
}

do_limits.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_limits.synopses = ['{{name}} {{cmd}}'];

do_limits.help = [
    'Show account provisioning limit information',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_limits;
