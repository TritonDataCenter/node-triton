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
var path = require('path');
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
            minHelpCol: 30
        },
        helpSubcmds: [
            'help',
            { group: 'Operator Commands' },
            'account',
            'info',
            'keys',
            { group: 'Instances (aka VMs/Machines/Containers)' },
            'create-instance',
            'instances',
            'instance',
            'instance-audit',
            'start-instance',
            'stop-instance',
            'reboot-instance',
            'delete-instance',
            'wait-instance',
            'ssh',
            { group: 'Images' },
            'images',
            'image',
            { group: 'Packages' },
            'packages',
            'package'
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
            var userConfigPath = require('./config').DEFAULT_USER_CONFIG_PATH;
            var dir = path.dirname(userConfigPath);
            var cacheDir = path.join(dir, 'cache');

            [dir, cacheDir].forEach(function (d) {
                try {
                    fs.mkdirSync(d);
                } catch (e) {
                    log.info({err: e}, 'failed to make dir %s', d);
                }
            });

            self._triton = new Triton({
                log: log,
                profile: opts.profile,
                config: userConfigPath,
                cachedir: cacheDir
            });
        }
        return self._triton;
    });

    // Cmdln class handles `opts.help`.
    Cmdln.prototype.init.apply(this, arguments);
};



//CLI.prototype.do_profile = require('./do_profile');

// Operator
CLI.prototype.do_account = require('./do_account');
CLI.prototype.do_info = require('./do_info');
CLI.prototype.do_keys = require('./do_keys');

// Images
CLI.prototype.do_images = require('./do_images');
CLI.prototype.do_image = require('./do_image');

// Instances (aka VMs/containers/machines)
CLI.prototype.do_instance = require('./do_instance');
CLI.prototype.do_instances = require('./do_instances');
CLI.prototype.do_create_instance = require('./do_create_instance');
CLI.prototype.do_instance_audit = require('./do_instance_audit');
CLI.prototype.do_stop_instance = require('./do_startstop_instance')('stop');
CLI.prototype.do_start_instance = require('./do_startstop_instance')('start');
CLI.prototype.do_reboot_instance = require('./do_startstop_instance')('reboot');
CLI.prototype.do_delete_instance = require('./do_startstop_instance')('delete');
CLI.prototype.do_wait_instance = require('./do_wait_instance');
CLI.prototype.do_ssh = require('./do_ssh');

// Packages
CLI.prototype.do_packages = require('./do_packages');
CLI.prototype.do_package = require('./do_package');

// Hidden commands
CLI.prototype.do_cloudapi = require('./do_cloudapi');
CLI.prototype.do_badger = require('./do_badger');





//---- mainline

if (require.main === module) {
    var cli = new CLI();
    cmdln.main(cli, {showNoCommandErr: false});
}

//---- exports

module.exports = CLI;
