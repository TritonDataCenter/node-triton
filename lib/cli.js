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

var OPTIONS = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Print this help and exit.'
    },
    {
        name: 'version',
        type: 'bool',
        help: 'Print version and exit.'
    },
    {
        names: ['verbose', 'v'],
        type: 'bool',
        help: 'Verbose/debug output.'
    },

    // XXX disable profile selection for now
    //{names: ['profile', 'p'], type: 'string', env: 'TRITON_PROFILE',
    //    helpArg: 'NAME', help: 'Triton client profile to use.'}

    {
        group: 'CloudAPI Options'
    },
    // XXX SDC_USER support. I don't grok the node-smartdc/README.md discussion
    //      of SDC_USER.
    {
        names: ['account', 'a'],
        type: 'string',
        env: 'SDC_ACCOUNT',
        help: 'Triton account (login name)',
        helpArg: 'ACCOUNT'
    },
    // XXX
    //{
    //    names: ['subuser', 'user'],
    //    type: 'string',
    //    env: 'MANTA_SUBUSER',
    //    help: 'Manta User (login name)',
    //    helpArg: 'USER'
    //},
    //{
    //    names: ['role'],
    //    type: 'arrayOfString',
    //    env: 'MANTA_ROLE',
    //    help: 'Assume a role. Use multiple times or once with a list',
    //    helpArg: 'ROLE,ROLE,...'
    //},
    {
        names: ['keyId', 'k'],
        type: 'string',
        env: 'SDC_KEY_ID',
        help: 'SSH key fingerprint',
        helpArg: 'FINGERPRINT'
    },
    {
        names: ['url', 'u'],
        type: 'string',
        env: 'SDC_URL',
        help: 'CloudAPI URL',
        helpArg: 'URL'
    },
    {
        names: ['J'],
        type: 'string',
        hidden: true,
        help: 'Joyent Public Cloud (JPC) datacenter name. This is ' +
            'a shortcut to the "https://$dc.api.joyent.com" ' +
            'cloudapi URL.'
    },
    {
        names: ['insecure', 'i'],
        type: 'bool',
        help: 'Do not validate SSL certificate',
        'default': false,
        env: 'SDC_TLS_INSECURE'  // Deprecated SDC_TESTING supported below.
    }
];


//---- CLI class

function CLI() {
    Cmdln.call(this, {
        name: pkg.name,
        desc: pkg.description,
        options: OPTIONS,
        helpOpts: {
            includeEnv: true,
            minHelpCol: 30
        },
        helpSubcmds: [
            'help',
            { group: 'Other Commands' },
            'info',
            'account',
            'keys',
            'services',
            'datacenters',
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
            'package',
            { group: 'Networks' },
            'networks',
            'network'
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
        this.showErrStack = true;
    }

    this.__defineGetter__('triton', function () {
        if (self._triton === undefined) {
            var userConfigPath = require('./config').DEFAULT_USER_CONFIG_PATH;
            var dir = path.dirname(userConfigPath);
            var cacheDir = path.join(dir, 'cache');

            if (!fs.existsSync(cacheDir)) {
                try {
                    fs.mkdirSync(cacheDir);
                } catch (e) {
                    log.info({err: e}, 'failed to make dir %s', cacheDir);
                }
            }

            // XXX support keyId being a priv or pub key path, a la imgapi-cli
            // XXX Add TRITON_* envvars.
            var envProfile = {
                name: 'env',
                account: opts.account,
                url: opts.url,
                keyId: opts.keyId,
                insecure: opts.insecure
            };
            // If --insecure not given, look at envvar(s) for that.
            var specifiedInsecureOpt = opts._order.filter(
                function (opt) { return opt.key === 'insecure'; }).length > 0;
            if (!specifiedInsecureOpt && process.env.SDC_TESTING) {
                envProfile.insecure = common.boolFromString(
                    process.env.SDC_TESTING,
                    false, '"SDC_TESTING" envvar');
            }
            if (opts.J) {
                envProfile.url = format('https://%s.api.joyent.com', opts.J);
            }
            log.trace({envProfile: envProfile}, 'envProfile');

            self._triton = new Triton({
                log: log,
                profileName: opts.profile,
                envProfile: envProfile,
                configPath: userConfigPath,
                cacheDir: cacheDir
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
CLI.prototype.do_services = require('./do_services');
CLI.prototype.do_datacenters = require('./do_datacenters');
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

// Networks
CLI.prototype.do_networks = require('./do_networks');
CLI.prototype.do_network = require('./do_network');

// Hidden commands
CLI.prototype.do_cloudapi = require('./do_cloudapi');
CLI.prototype.do_badger = require('./do_badger');





//---- mainline

function main(argv) {
    if (!argv) {
        argv = process.argv;
    }

    var cli = new CLI();
    cli.main(argv, function (err, subcmd) {
        var exitStatus = (err ? err.exitStatus || 1 : 0);
        var showErr = (cli.showErr !== undefined ? cli.showErr : true);

        if (err && showErr) {
            var code = (err.body ? err.body.code : err.code);
            if (code === 'NoCommand') {
                /* jsl:pass */
            } else if (err.message !== undefined) {
                console.error('%s%s: error%s: %s',
                    cli.name,
                    (subcmd ? ' ' + subcmd : ''),
                    (code ? format(' (%s)', code) : ''),
                    (cli.showErrStack ? err.stack : err.message));

                // If this is a usage error, attempt to show some usage info.
                if (['Usage', 'Option'].indexOf(code) !== -1 && subcmd) {
                    var help = cli.helpFromSubcmd(subcmd);
                    if (help) {
                        // Would like a shorter synopsis. Attempt to
                        // parse it down, somewhat generally.
                        var usageIdx = help.indexOf('\nUsage:');
                        if (usageIdx !== -1) {
                            help = help.slice(usageIdx);
                        }
                        console.error(help);
                    }
                }
            }
        }

        process.exit(exitStatus);
    });
}

//---- exports

module.exports = {
    CLI: CLI,
    main: main
};
