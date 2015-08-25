/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * The `triton` CLI class.
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var cmdln = require('cmdln'),
    Cmdln = cmdln.Cmdln;
var fs = require('fs');
var util = require('util'),
    format = util.format;
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');
var Triton = require('./triton');



//---- globals

var p = console.log;

var pkg = require('../package.json');
var name = 'triton';
var log = bunyan.createLogger({
    name: name,
    serializers: bunyan.stdSerializers,
    stream: process.stderr,
    level: 'warn'
});



//---- CLI class

function CLI() {
    Cmdln.call(this, {
        name: pkg.name,
        desc: pkg.description,
        options: [
            {names: ['help', 'h'], type: 'bool', help: 'Print help and exit.'},
            {name: 'version', type: 'bool', help: 'Print version and exit.'},
            {names: ['verbose', 'v'], type: 'bool',
                help: 'Verbose/debug output.'},
            {names: ['profile', 'p'], type: 'string', env: 'SMRT_PROFILE',
                helpArg: 'NAME', help: 'SMRT Profile to use.'}
        ],
        helpOpts: {
            includeEnv: true,
            minHelpCol: 23 /* line up with option help */
        }
    });
}
util.inherits(CLI, Cmdln);

CLI.prototype.init = function (opts, args, callback) {
    var self = this;

    if (opts.version) {
        p(this.name, pkg.version);
        callback(false);
        return;
    }
    this.opts = opts;
    if (opts.verbose) {
        log.level('trace');
        log.src = true;
    }

    this.__defineGetter__('triton', function () {
        if (self._triton === undefined) {
            self._triton = new Triton({log: log, profile: opts.profile});
        }
        return self._triton;
    });

    // Cmdln class handles `opts.help`.
    Cmdln.prototype.init.apply(this, arguments);
};

CLI.prototype.do_foo = function do_foo(subcmd, opts, args, callback) {
    console.log('XXX', subcmd, opts, args);

    this.triton.cloudapi.getAccount(function (err, body, res) {
       console.log('XXX getAccount', err);
       console.log('XXX getAccount', body);
        callback();
    });
};



CLI.prototype.do_profile = require('./do_profile');
CLI.prototype.do_images = require('./do_images');



CLI.prototype.do_provision = function (subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }
    var sdc = this.sdc;

    assert.string(opts.image, '--image <img>');
    assert.string(opts['package'], '--package <pkg>');
    assert.number(opts.count)

    // XXX
    /*
     * Should all this move into sdc.createMachine? yes
     *
     * - lookup image, package, networks from args
     * - assign names
     * - start provisions (slight stagger, max N at a time)
     * - return immediately, or '-w|--wait'
     */
    async.series([
        function lookups(next) {
            async.parallel([
                //XXX
                //sdc.lookup(image)
            ])
        },
        function provisions(next) {

        },
        function wait(next) {
            next();
        }
    ], function (err) {
        callback(err);
    });
};
CLI.prototype.do_provision.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['dc', 'd'],
        type: 'string',
        helpArg: '<dc>',
        help: 'The datacenter in which to provision. Required if the current'
            + ' profile includes more than one datacenter. Use `sdc profile`'
            + ' to list profiles and `sdc dcs` to list available datacenters.'
    },
    {
        names: ['image', 'i'],
        type: 'string',
        helpArg: '<img>',
        help: 'The machine image with which to provision. Required.'
    },
    {
        names: ['package', 'p'],
        type: 'string',
        helpArg: '<pkg>',
        help: 'The package or instance type for the new machine(s). Required.'
    },
    {
        names: ['name', 'n'],
        type: 'string',
        helpArg: '<name>',
        help: 'A name for the machine. If not specified, a short random name'
            + ' will be generated.',
        // TODO: for count>1 support '%d' code in name: foo0, foo1, ...
    },
    {
        names: ['count', 'c'],
        type: 'positiveInteger',
        'default': 1,
        helpArg: '<n>',
        help: 'The number of machines to provision. Default is 1.'
    },
];
CLI.prototype.do_provision.help = (
    'Provision a new virtual machine instance.\n'
    + 'Alias: create-machine.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} provision <options>\n'
    + '\n'
    + '{{options}}'
);


CLI.prototype.do_machines = function (subcmd, opts, args, callback) {
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
CLI.prototype.do_machines.options = [
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
CLI.prototype.do_machines.help = (
    'List machines.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} machines [<filters>...]\n'
    + '\n'
    + '{{options}}'
);



CLI.prototype.do_machine_audit = function (subcmd, opts, args, callback) {
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
CLI.prototype.do_machine_audit.options = [
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
CLI.prototype.do_machine_audit.help = (
    'List machine actions.\n'
    + '\n'
    + 'Note: On the *client*-side, this adds the "dc" attribute to each\n'
    + 'audit record.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} machine-audit <machine>\n'
    + '\n'
    + '{{options}}'
);


//---- mainline

if (require.main === module) {
    var cli = new CLI();
    cmdln.main(cli, {showNoCommandErr: false});
}

//---- exports

module.exports = CLI;
