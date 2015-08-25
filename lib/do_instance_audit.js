/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton instance-audit ...`
 */

var format = require('util').format;
var tabula = require('tabula');

var errors = require('./errors');


function do_instance_audit(subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        //XXX Support multiple machines.
        return callback(new Error('too many args: ' + args));
    }

    var id = args[0];
    this.sdc.machineAudit({machine: id}, function (err, audit, dc) {
        if (err) {
            return callback(err);
        }
        for (var i = 0; i < audit.length; i++) {
            audit[i].dc = dc;
        }
        if (opts.json) {
            p(JSON.stringify(audit, null, 4));
        } else {
            return callback(new error.InternalError("tabular output for audit NYI")); // XXX
            //common.tabulate(audit, {
            //    columns: 'dc,id,name,state,created',
            //    sort: 'created',
            //    validFields: 'dc,id,name,type,state,image,package,memory,'
            //        + 'disk,created,updated,compute_node,primaryIp'
            //});
        }
        callback();
    });
};
do_instance_audit.options = [
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
do_instance_audit.help = (
    'List instance actions.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} instance-audit <machine>\n'
    + '\n'
    + '{{options}}'
);



module.exports = do_instance_audit;
