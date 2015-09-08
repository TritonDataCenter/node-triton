/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton instance-audit ...`
 */

var format = require('util').format;
var tabula = require('tabula');

var common = require('./common');
var errors = require('./errors');

// columns default without -o
var columnsDefault = 'id,time,action,success';

// sort default with -s
var sortDefault = 'id,time';

function do_instance_audit(subcmd, opts, args, cb) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        //XXX Support multiple machines.
        return cb(new Error('incorrect args: ' + args));
    }

    var columns = opts.o.split(',');
    var sort = opts.s.split(',');

    var arg = args[0];
    var uuid;

    if (common.isUUID(arg)) {
        uuid = arg;
        go1();
    } else {
        self.tritonapi.getInstance(arg, function (err, inst) {
            if (err) {
                cb(err);
                return;
            }
            uuid = inst.id;
            go1();
        });
    }

    function go1() {
        self.tritonapi.cloudapi.machineAudit(uuid, function (err, audit) {
            if (err) {
                cb(err);
                return;
            }

            audit.forEach(function (a) {
                a.id = uuid;
            });

            if (opts.json) {
                common.jsonStream(audit);
            } else {
                tabula(audit, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort,
                    dottedLookup: true
                });
            }
            cb();
        });
    }
}

do_instance_audit.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    columnsDefault: columnsDefault,
    sortDefault: sortDefault
}));

do_instance_audit.help = (
    'List instance actions.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} instance-audit <machine>\n'
    + '\n'
    + '{{options}}'
);



module.exports = do_instance_audit;
