/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton vms ...`
 */

var format = require('util').format;
var tabula = require('tabula');

var errors = require('./errors');


do_vms = function do_vms(subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }

    var machines = [];
    var errs = [];
    var res = this.sdc.listMachines();
    res.on('data', function (dc, dcMachines) {
        for (var i = 0; i < dcMachines.length; i++) {
            dcMachines[i].dc = dc;
            machines.push(dcMachines[i]);
        }
    });
    res.on('dcError', function (dc, dcErr) {
        dcErr.dc = dc;
        errs.push(dcErr);
    });
    res.on('end', function () {
        if (opts.json) {
            p(JSON.stringify(machines, null, 4));
        } else {
            /* BEGIN JSSTYLED */
            // TODO: get short output down to something like
            //  'us-west-1  e91897cf  testforyunong2  linux  running       2013-11-08'
            //  'us-west-1  e91897cf  testforyunong2  ubuntu/13.3.0  running       2013-11-08'
            /* END JSSTYLED */
            common.tabulate(machines, {
                columns: 'dc,id,name,image,state,created',
                sort: 'created',
                validFields: 'dc,id,name,type,state,image,package,memory,'
                    + 'disk,created,updated,compute_node,primaryIp'
            });
        }
        var err;
        if (errs.length === 1) {
            err = errs[0];
        } else if (errs.length > 1) {
            err = new errors.MultiError(errs);
        }
        callback(err);
    });
};
do_vms.options = [
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
do_vms.help = (
    'List VMs/machines/containers.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} vms [<filters>...]\n'
    + '\n'
    + '{{options}}'
);


module.exports = do_vms;