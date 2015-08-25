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
            // XXX disable profile selection for now
            //{names: ['profile', 'p'], type: 'string', env: 'TRITON_PROFILE',
            //    helpArg: 'NAME', help: 'Triton client profile to use.'}
        ],
        helpOpts: {
            includeEnv: true,
            minHelpCol: 23 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            { group: 'Instances (aka VMs/Machines/Containers)' },
            'create',
            'instances',
            'instance-audit',
            { group: 'Images' },
            'images',
            'image',
            { group: 'Other', unmatched: true }
        ]
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



//CLI.prototype.do_profile = require('./do_profile');

// Images
CLI.prototype.do_images = require('./do_images');
CLI.prototype.do_image = require('./do_image');

// Instances (aka VMs/containers/machines)
CLI.prototype.do_create = require('./do_create');
CLI.prototype.do_instances = require('./do_instances');
CLI.prototype.do_instance_audit = require('./do_instance_audit');

// Packages
CLI.prototype.do_packages = require('./do_packages');

// Row Cloud API
CLI.prototype.do_cloudapi = require('./do_cloudapi');





//---- mainline

if (require.main === module) {
    var cli = new CLI();
    cmdln.main(cli, {showNoCommandErr: false});
}

//---- exports

module.exports = CLI;
