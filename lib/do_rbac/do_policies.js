/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac policies ...`
 */

var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');



// columns default without -o
var columnsDefault = 'shortid,name,description,nrules';

// columns default with -l
var columnsDefaultLong = 'id,name,rules';

// sort default with -s
var sortDefault = 'name';


function do_policies(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 0) {
        cb(new errors.UsageError('invalid args: ' + args));
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

    this.top.tritonapi.cloudapi.listPolicies(function (err, policies) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(policies);
        } else {
            // Add some convenience fields
            for (var i = 0; i < policies.length; i++) {
                var role = policies[i];
                role.shortid = role.id.split('-', 1)[0];
                role.nrules = role.rules.length;
                role.rules = role.rules.sort().join('; ');
            }

            tabula(policies, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort
            });
        }
        cb();
    });
}

do_policies.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_policies.help = (
    /* BEGIN JSSTYLED */
    'List RBAC policies.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} policies [<options>]\n' +
    '\n' +
    '{{options}}' +
    '\n' +
    'Fields (most are self explanatory, the client adds some for convenience):\n' +
    '    shortid            A short ID prefix.\n' +
    '    nrules             The number of rules in this policy.\n'
    /* END JSSTYLED */
);



module.exports = do_policies;
