/*
 * Copyright (c) 2014 Joyent Inc. All rights reserved.
 *
 * The 'sdc' CLI class.
 */

var p = console.log;
var e = console.error;
var util = require('util'),
    format = util.format;
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var fs = require('fs');

var assert = require('assert-plus');
var async = require('async');
var bunyan = require('bunyan');
var cmdln = require('cmdln'),
    Cmdln = cmdln.Cmdln;

var common = require('./common');
var errors = require('./errors');
var SDC = require('./sdc');



//---- globals

var pkg = require('../package.json');
var name = 'sdc';
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
        process.env.DEBUG = 1; //TODO This is a lame req of cmdln.main().
        log.level('trace');
        log.src = true;
    }

    this.__defineGetter__('sdc', function () {
        if (self._sdc === undefined) {
            self._sdc = new SDC({log: log, profile: opts.profile});
        }
        return self._sdc;
    });

    // Cmdln class handles `opts.help`.
    Cmdln.prototype.init.apply(this, arguments);
};


CLI.prototype.do_config = function (subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var action;
    var actions = [];
    if (opts.add) actions.push('add');
    if (opts['delete']) actions.push('delete');
    if (opts.edit) actions.push('edit');
    if (actions.length === 0) {
        action = 'show';
    } else if (actions.length > 1) {
        return callback(new errors.UsageError(
            'cannot specify more than one action: ' + actions.join(', ')));
    } else {
        action = actions[0];
    }
    var numArgs = {

    }

    if (action === 'show') {
        var c = common.objCopy(this.sdc.config);
        delete c._defaults;
        delete c._user;
        if (args.length > 1) {
            return callback(new errors.UsageError('too many args'));
        } else if (args.length === 1) {
            var lookups = args[0].split(/\./g);
            for (var i = 0; i < lookups.length; i++) {
                c = c[lookups[i]];
                if (c === undefined) {
                    return callback(new errors.UsageError(
                        'no such config var: ' + args[0]));
                }
            }
        }
        if (typeof(c) === 'string') {
            console.log(c)
        } else {
            console.log(JSON.stringify(c, null, 4));
        }
    } else if (action === 'add') {
        if (args.length !== 2)
            return callback(new errors.UsageError('incorrect number of args'));
        XXX
    } else if (action === 'delete') {
        if (args.length !== 1)
            return callback(new errors.UsageError('incorrect number of args'));
        XXX
    } else if (action === 'edit') {
        if (args.length !== 0)
            return callback(new errors.UsageError('incorrect number of args'));
        XXX
    }

    callback();
};
CLI.prototype.do_config.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['add', 'a'],
        type: 'bool',
        help: 'Add a config var.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete a config var.'
    },
    {
        names: ['edit', 'e'],
        type: 'bool',
        help: 'Edit config in $EDITOR.'
    }
];
CLI.prototype.do_config.help = (
    'Show and edit the `sdc` CLI config.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} config                     # show config\n'
    + '     {{name}} config <name>              # show particular config var\n'
    + '     {{name}} config -a <name> <value>   # add/set a config var\n'
    + '     {{name}} config -d <name>           # delete a config var\n'
    + '     {{name}} config -e                  # edit config in $EDITOR\n'
    + '\n'
    + '{{options}}'
);


CLI.prototype.do_profile = function (subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }

    var profs = common.deepObjCopy(this.sdc.profiles);
    var currProfileName = this.sdc.profile.name;
    for (var i = 0; i < profs.length; i++) {
        profs[i].curr = (profs[i].name === currProfileName ? '*' : ' ');
        profs[i].dcs = (profs[i].dcs ? profs[i].dcs : ['all'])
            .join(',');
    }
    if (opts.json) {
        p(JSON.stringify(profs, null, 4));
    } else {
        common.tabulate(profs, {
            columns: 'curr,name,dcs,user,keyId',
            sort: 'name,user',
            validFields: 'curr,name,dcs,user,keyId'
        });
    }
    callback();
};
CLI.prototype.do_profile.options = [
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
CLI.prototype.do_profile.help = (
    'Create, update or inpect joyent CLI profiles.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} profile\n'
    + '\n'
    + '{{options}}'
);


CLI.prototype.do_dcs = function (subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var action = args[0] || 'list';
    var name;
    var url;
    switch (action) {
    case 'list':
        if (args.length !== 0) {
            return callback(new errors.UsageError('too many args: ' + args));
        }
        var dcs = self.sdc.config.dc;
        var dcsArray = Object.keys(dcs).map(
            function (n) { return {name: n, url: dcs[n]}; });
        if (self.sdc.config.dcAlias) {
            Object.keys(self.sdc.config.dcAlias).forEach(function (alias) {
                dcsArray.push(
                    {alias: alias, names: self.sdc.config.dcAlias[alias]});
            });
        }
        if (opts.json) {
            p(JSON.stringify(dcsArray, null, 4));
        } else {
            for (var i = 0; i < dcsArray.length; i++) {
                var d = dcsArray[i];
                d.name = (d.name ? d.name : d.alias + '*');
                d.url = d.url || d.names.join(', ');
            }
            common.tabulate(dcsArray, {
                columns: 'name,url',
                sort: 'alias,name',
                validFields: 'name,url,alias,names'
            });
        }
        callback();
        break;
    case 'rm':
        if (args.length !== 2) {
            return callback(new errors.UsageError(
                'incorrect number of args: ' + args));
        }
        name = args[1];
        XXX
        break;
    case 'add':
        if (args.length !== 3) {
            return callback(new errors.UsageError(
                'incorrect number of args: ' + args));
        }
        name = args[1];
        url = args[2];
        XXX
        break;
    default:
        return callback(new errors.UsageError('unknown dcs command: ' + args))
    }
};
CLI.prototype.do_dcs.options = [
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
CLI.prototype.do_dcs.help = (
    'List, add or remove datacenters.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} dcs                    # list DCs (and DC aliases marked with "*")\n'
    + '     {{name}} dcs add <name> <url>   # add an SDC cloudapi endpoint\n'
    + '     {{name}} dcs rm <name>          # remove a DC\n'
    + '\n'
    + '{{options}}'
);


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
CLI.prototype.do_provision.aliases = ['create-machine'];


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



//---- exports

module.exports = CLI;
