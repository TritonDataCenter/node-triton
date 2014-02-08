/*
 * Copyright (c) 2014 Joyent Inc. All rights reserved.
 *
 * The 'joyentcloud' CLI class.
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
var JoyentCloud = require('./joyentcloud');



//---- globals

var pkg = require('../package.json');
var name = 'joyentcloud';
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
                help: 'Verbose/debug output.'}
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

    this.__defineGetter__('joyent', function () {
        if (self._joyent === undefined) {
            self._joyent = new JoyentCloud({log: log});
        }
        return self._joyent;
    });

    // Cmdln class handles `opts.help`.
    Cmdln.prototype.init.apply(this, arguments);
};


CLI.prototype.do_profile = function (subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }

    var profs = common.deepObjCopy(this.joyent.profiles);
    var currProfileName = this.joyent.profile.name;
    for (var i = 0; i < profs.length; i++) {
        profs[i].curr = (profs[i].name === currProfileName ? '*' : ' ');
        profs[i].dcs = (profs[i].dcs ? Object.keys(profs[i].dcs) : ['all'])
            .join(',');
    }
    if (opts.json) {
        p(JSON.stringify(profs, null, 4));
    } else {
        common.tabulate(profs, {
            columns: 'curr,name,dcs,account,keyId',
            sort: 'name,account',
            validFields: 'curr,name,dcs,account,keyId'
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
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }

    var dcs = this.joyent.config.dcs;
    var dcsArray = Object.keys(dcs).map(
        function (n) { return {name: n, url: dcs[n]}; });
    if (opts.json) {
        p(JSON.stringify(dcsArray, null, 4));
    } else {
        common.tabulate(dcsArray, {
            columns: 'name,url',
            sort: 'name',
            validFields: 'name,url'
        });
    }
    callback();
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
    + '     {{name}} dcs\n'
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

    //XXX joyent.listMachines should change to return a 'res' event emitter
    //    that emits 'dcError' and 'data'.
    var listOpts = {
        onDcError: function (dc, dcErr) {
            console.warn('%s machines: dc %s error: %s', self.name, dc, dcErr);
        }
    };
    this.joyent.listMachines(listOpts, function (err, machines) {
        if (err)
            return callback(err);
        if (opts.json) {
            p(JSON.stringify(machines, null, 4));
        } else {
            /* BEGIN JSSTYLED */
            // TODO: get short output down to something like
            //  'us-west-1  e91897cf  testforyunong2  linux  running       2013-11-08'
            //  'us-west-1  e91897cf  testforyunong2  ubuntu/13.3.0  running       2013-11-08'
            /* END JSSTYLED */
            common.tabulate(machines, {
                columns: 'dc,id,name,state,created',
                sort: 'created',
                validFields: 'dc,id,name,type,state,image,package,memory,'
                    + 'disk,created,updated,compute_node,primaryIp'
            });
        }
        callback();
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




//---- exports

module.exports = CLI;
