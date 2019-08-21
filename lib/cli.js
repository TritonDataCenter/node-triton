/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
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
var mkdirp = require('mkdirp');
var util = require('util'),
    format = util.format;
var path = require('path');
var vasync = require('vasync');

var common = require('./common');
var constants = require('./constants');
var mod_config = require('./config');
var errors = require('./errors');
var lib_tritonapi = require('./tritonapi');



//---- globals

var packageJson = require('../package.json');


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

    {
        names: ['profile', 'p'],
        type: 'string',
        completionType: 'tritonprofile',
        env: 'TRITON_PROFILE',
        helpArg: 'NAME',
        help: 'Triton client profile to use.'
    },

    {
        group: 'CloudAPI Options'
    },

    /*
     * Environment variable integration.
     *
     * While dashdash supports integrated envvar parsing with options
     * we don't use that with `triton` because (a) we want to apply *option*
     * usage (but not envvars) to profiles other than the default 'env'
     * profile, and (b) we want to support `TRITON_*` *and* `SDC_*` envvars,
     * which dashdash doesn't support.
     *
     * See <https://github.com/joyent/node-triton/issues/28> for some details.
     */
    {
        names: ['account', 'a'],
        type: 'string',
        help: 'Account (login name). Environment: TRITON_ACCOUNT=ACCOUNT ' +
            'or SDC_ACCOUNT=ACCOUNT.',
        helpArg: 'ACCOUNT'
    },
    {
        names: ['act-as'],
        type: 'string',
        help: 'Masquerade as the given account login name. This is useful ' +
            'for operator accounts and members of cross-account roles. Note ' +
            'that accesses like these are audited on the CloudAPI server ' +
            'side. Environment: TRITON_ACT_AS=ACCOUNT.',
        helpArg: 'ACCOUNT'
    },
    {
        names: ['user', 'u'],
        type: 'string',
        help: 'RBAC user (login name). Environment: TRITON_USER=USER ' +
            'or SDC_USER=USER.',
        helpArg: 'USER'
    },
    {
        names: ['role', 'r'],
        type: 'arrayOfCommaSepString',
        env: 'TRITON_ROLE',
        help: 'Assume an RBAC role. Use multiple times or once with a list',
        helpArg: 'ROLE,...'
    },
    {
        names: ['keyId', 'k'],
        type: 'string',
        help: 'SSH key fingerprint. Environment: TRITON_KEY_ID=FINGERPRINT ' +
            'or SDC_KEY_ID=FINGERPRINT.',
        helpArg: 'FP'
    },
    {
        names: ['url', 'U'],
        type: 'string',
        help: 'CloudAPI URL. Environment: TRITON_URL=URL or SDC_URL=URL.',
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
        help: 'Do not validate the CloudAPI SSL certificate. Environment: ' +
            'TRITON_TLS_INSECURE=1, SDC_TLS_INSECURE=1 (or the deprecated ' +
            'SDC_TESTING=1).',
        'default': false
    },
    {
        names: ['accept-version'],
        type: 'string',
        helpArg: 'VER',
        help: 'A cloudapi API version, or semver range, to attempt to use. ' +
            'This is passed in the "Accept-Version" header. ' +
            'See `triton cloudapi /--ping` to list supported versions. ' +
            'The default is "' + lib_tritonapi.CLOUDAPI_ACCEPT_VERSION + '". ' +
            '*This is intended for development use only. It could cause ' +
            '`triton` processing of responses to break.*',
        hidden: true
    }
];



// ---- other support stuff

function parseCommaSepStringNoEmpties(option, optstr, arg) {
    // JSSTYLED
    return arg.trim().split(/\s*,\s*/g)
        .filter(function (part) { return part; });
}

cmdln.dashdash.addOptionType({
    name: 'commaSepString',
    takesArg: true,
    helpArg: 'STRING',
    parseArg: parseCommaSepStringNoEmpties
});

cmdln.dashdash.addOptionType({
    name: 'arrayOfCommaSepString',
    takesArg: true,
    helpArg: 'STRING',
    parseArg: parseCommaSepStringNoEmpties,
    array: true,
    arrayFlatten: true
});



//---- CLI class

function CLI() {
    Cmdln.call(this, {
        name: 'triton',
        desc: packageJson.description,
        options: OPTIONS,
        helpOpts: {
            includeEnv: true,
            minHelpCol: 30
        },
        helpSubcmds: [
            'help',
            'profile',
            'env',
            'completion',
            { group: 'Instances (aka VMs/Machines/Containers)' },
            'instance',
            'instances',
            'create',
            'delete',
            'start',
            'stop',
            'reboot',
            'ssh',
            'ip',
            { group: 'Images, Packages, Networks, Firewall Rules' },
            'image',
            'package',
            'network',
            'fwrule',
            'vlan',
            { group: 'Other Commands' },
            'info',
            'account',
            'key',
            'services',
            'datacenters'
        ],
        helpBody: [
            /* BEGIN JSSTYLED */
            'Exit Status:',
            '    0   Successful completion.',
            '    1   An error occurred.',
            '    2   Usage error.',
            '    3   "ResourceNotFound" error (when an instance, image, etc. with',
            '        the given name or id is not found) or "InstanceDeleted" error.'
            /* END JSSTYLED */
        ].join('\n')
    });
}
util.inherits(CLI, Cmdln);

CLI.prototype.init = function (opts, args, callback) {
    var self = this;
    this.opts = opts;

    this.log = bunyan.createLogger({
        name: this.name,
        serializers: bunyan.stdSerializers,
        stream: process.stderr,
        level: 'warn'
    });
    if (opts.verbose) {
        this.log.level('trace');
        this.log.src = true;
        this.showErrStack = true;
    }

    if (opts.version) {
        console.log('Triton CLI', packageJson.version);
        console.log(packageJson.homepage);
        callback(false);
        return;
    }

    if (opts.url && opts.J) {
        callback(new errors.UsageError(
            'cannot use both "--url" and "-J" options'));
    } else if (opts.J) {
        opts.url = format('https://%s.api.joyent.com', opts.J);
    }

    this.configDir = constants.CLI_CONFIG_DIR;

    this.__defineGetter__('config', function getConfig() {
        if (self._config === undefined) {
            self._config = mod_config.loadConfig({
                configDir: self.configDir
            });
            self.log.trace({config: self._config}, 'loaded config');
        }
        return self._config;
    });

    this.__defineGetter__('profileName', function getProfileName() {
        return (opts.profile || self.config.profile || 'env');
    });

    this.__defineGetter__('profile', function getProfile() {
        if (self._profile === undefined) {
            try {
                self._profile = mod_config.loadProfile({
                    configDir: self.configDir,
                    name: self.profileName,
                    profileOverrides: self._cliOptsAsProfile()
                });
            } catch (pErr) {
                /*
                 * Let's be nice for the getting started use case where we
                 * defaulted to 'env' profile (e.g. the user has never created
                 * one) and the minimal envvars aren't set. I.e. The user just
                 * installed and ran `triton ls` or some other command.
                 */
                if (pErr.code === 'Config' && self.profileName === 'env' &&
                    !opts.profile && !self.config.profile)
                {
                    /* BEGIN JSSTYLED */
                    pErr.message += '\n'
                        + '    No profile information could be loaded.\n'
                        + '    Use "triton profile create" to create a profile or provide\n'
                        + '    the required "CloudAPI options" described in "triton --help".\n'
                        + '    See https://github.com/joyent/node-triton#setup for more help.';
                    /* END JSSTYLED */
                }
                throw pErr;
            }
            self.log.trace({profile: self._profile}, 'loaded profile');
        }
        return self._profile;
    });

    this.__defineGetter__('tritonapi', function getTritonapi() {
        if (self._tritonapi === undefined) {
            self._tritonapi = lib_tritonapi.createClient({
                log: self.log,
                profile: self.profile,
                config: self.config
            });
            self.log.trace('created tritonapi');
        }
        return self._tritonapi;
    });

    if (process.env.TRITON_COMPLETE) {
        /*
         * If `TRITON_COMPLETE=<type>` is set (typically only in the
         * Triton CLI bash completion driver, see
         * "etc/triton-bash-completion-types.sh"), then Bash completions are
         * fetched and printed, instead of the usual subcommand handling.
         *
         * Completion results are typically cached (under "~/.triton/cache")
         * to avoid hitting the server for data everytime.
         *
         * Example usage:
         *      TRITON_COMPLETE=images triton -p my-profile create
         */
        self._emitCompletions(process.env.TRITON_COMPLETE, function (err) {
            callback(err || false);
        });
    } else {
        // Cmdln class handles `opts.help`.
        Cmdln.prototype.init.call(self, opts, args, callback);
    }
};


CLI.prototype.fini = function fini(subcmd, err, cb) {
    this.log.trace({err: err, subcmd: subcmd}, 'cli fini');
    if (this._tritonapi) {
        this._tritonapi.close();
        delete this._tritonapi;
    }
    cb();
};


/*
 * Fetch and display Bash completions (one completion per line) for the given
 * Triton data type (e.g. 'images', 'instances', 'packages', ...).
 * This caches results (per profile) with a 5 minute TTL.
 *
 * Dev Note: If the cache path logic changes, then the *Bash* implementation
 * of the same logic in "etc/triton-bash-completion-types.sh" must be updated
 * to match.
 */
CLI.prototype._emitCompletions = function _emitCompletions(type, cb) {
    assert.string(type, 'type');
    assert.func(cb, 'cb');

    var cacheFile = path.join(this.tritonapi.cacheDir, type + '.completions');
    var ttl = 5 * 60 * 1000; // timeout of cache file info (ms)
    var tritonapi = this.tritonapi;

    vasync.pipeline({arg: {}, funcs: [
        function tryCacheFile(arg, next) {
            fs.stat(cacheFile, function (err, stats) {
                if (!err &&
                    stats.mtime.getTime() + ttl >= (new Date()).getTime()) {
                    process.stdout.write(fs.readFileSync(cacheFile));
                    next(true); // early abort
                } else if (err && err.code !== 'ENOENT') {
                    next(err);
                } else {
                    next();
                }
            });
        },
        function initAuth(args, next) {
            tritonapi.init(function (initErr) {
                if (initErr) {
                    next(initErr);
                }
                if (tritonapi.keyPair.isLocked()) {
                    next(new errors.TritonError(
                        'cannot unlock keys during completion'));
                }
                next();
            });
        },

        function gather(arg, next) {
            var completions;

            switch (type) {
            case 'packages':
                tritonapi.cloudapi.listPackages({}, function (err, pkgs) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    pkgs.forEach(function (pkg) {
                        if (pkg.name.indexOf(' ') === -1) {
                            // Cannot bash complete results with spaces, so
                            // skip them here.
                            completions.push(pkg.name);
                        }
                        completions.push(pkg.id);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'images':
                tritonapi.cloudapi.listImages({}, function (err, imgs) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    imgs.forEach(function (img) {
                        // Cannot bash complete results with spaces, so
                        // skip them here.
                        if (img.name.indexOf(' ') === -1) {
                            completions.push(img.name);
                            if (img.version.indexOf(' ') === -1) {
                                completions.push(img.name + '@' + img.version);
                            }
                        }
                        completions.push(img.id);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'instances':
                tritonapi.cloudapi.listMachines({}, function (err, insts) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    insts.forEach(function (inst) {
                        if (inst.name.indexOf(' ') === -1) {
                            // Cannot bash complete results with spaces, so
                            // skip them here.
                            completions.push(inst.name);
                        }
                        completions.push(inst.id);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'volumes':
                tritonapi.cloudapi.listVolumes({}, function (err, vols) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    vols.forEach(function (vol) {
                        completions.push(vol.name);
                        completions.push(vol.id);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'affinityrules':
                /*
                 * We exclude ids, in favour of just inst names here. The only
                 * justification for differing from other completion types
                 * on that is that with the additional prefixes, there would
                 * be too many.
                 */
                tritonapi.cloudapi.listMachines({}, function (err, insts) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    insts.forEach(function (inst) {
                        if (inst.name.indexOf(' ') === -1) {
                            // Cannot bash complete results with spaces, so
                            // skip them here.
                            completions.push('inst==' + inst.name);
                            completions.push('inst!=' + inst.name);
                            completions.push('inst==~' + inst.name);
                            completions.push('inst!=~' + inst.name);
                        }
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'networks':
                tritonapi.cloudapi.listNetworks({}, function (err, nets) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    nets.forEach(function (net) {
                        if (net.name.indexOf(' ') === -1) {
                            // Cannot bash complete results with spaces, so
                            // skip them here.
                            completions.push(net.name);
                        }
                        completions.push(net.id);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'fwrules':
                tritonapi.cloudapi.listFirewallRules({}, function (err,
                                                                   fwrules) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    fwrules.forEach(function (fwrule) {
                        completions.push(fwrule.id);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            case 'keys':
                tritonapi.cloudapi.listKeys({}, function (err, keys) {
                    if (err) {
                        next(err);
                        return;
                    }
                    completions = [];
                    keys.forEach(function (key) {
                        if (key.name.indexOf(' ') === -1) {
                            // Cannot bash complete results with spaces, so
                            // skip them here.
                            completions.push(key.name);
                        }
                        completions.push(key.fingerprint);
                    });
                    arg.completions = completions.join('\n') + '\n';
                    next();
                });
                break;
            default:
                process.stderr.write('warning: unknown triton completion type: '
                    + type + '\n');
                next();
                break;
            }
        },

        function saveCache(arg, next) {
            if (!arg.completions) {
                next();
                return;
            }
            fs.writeFile(cacheFile, arg.completions, next);
        },

        function emit(arg, next) {
            if (arg.completions) {
                console.log(arg.completions);
            }
            next();
        }
    ]}, function (err) {
        if (err === true) { // early abort signal
            err = null;
        }
        cb(err);
    });
};


/*
 * Apply overrides from CLI options to the given profile object *in place*.
 */
CLI.prototype._applyProfileOverrides =
    function _applyProfileOverrides(profile) {
        var optProfile = this._cliOptsAsProfile();
        for (var attr in optProfile) {
            profile[attr] = optProfile[attr];
        }
};

/*
 * Create a profile dict from any cli override options specified.
 * Unless all profile flags are specified on the cli, this profile
 * will be incomplete and will need to be combined with another
 * configuration source.
 */
CLI.prototype._cliOptsAsProfile = function _cliOptsAsProfile() {
    var self = this;
    var profile = {};
    [
        {oname: 'account', pname: 'account'},
        {oname: 'user', pname: 'user'},
        {oname: 'role', pname: 'roles'},
        {oname: 'url', pname: 'url'},
        {oname: 'keyId', pname: 'keyId'},
        {oname: 'insecure', pname: 'insecure'},
        {oname: 'accept_version', pname: 'acceptVersion'},
        {oname: 'act_as', pname: 'actAsAccount'}
    ].forEach(function (field) {
        // We need to check `opts._order` to know if boolean opts
        // were specified.
        var specified = self.opts._order.filter(
            function (opt) { return opt.key === field.oname; }).length > 0;
        if (specified) {
            profile[field.pname] = self.opts[field.oname];
        }
    });
    return profile;
};


/*
 * Create and return a TritonApi instance for the given profile name and using
 * the CLI's config. Callers of this should remember to `tritonapi.close()`
 * when complete... otherwise an HTTP Agent using keep-alive will keep node
 * from exiting until it times out.
 */
CLI.prototype.tritonapiFromProfileName =
        function tritonapiFromProfileName(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.profileName, 'opts.profileName');

    var profile;
    if (opts.profileName === this.profileName) {
        profile = this.profile;
    } else {
        profile = mod_config.loadProfile({
            configDir: this.configDir,
            name: opts.profileName
        });
        this.log.trace({profile: profile},
            'tritonapiFromProfileName: loaded profile');
    }

    return lib_tritonapi.createClient({
        log: this.log,
        profile: profile,
        config: this.config
    });
};


// Meta
CLI.prototype.do_completion = require('./do_completion');
CLI.prototype.do_profiles = require('./do_profiles');
CLI.prototype.do_profile = require('./do_profile');
CLI.prototype.do_env = require('./do_env');

// Other
CLI.prototype.do_account = require('./do_account');
CLI.prototype.do_services = require('./do_services');
CLI.prototype.do_datacenters = require('./do_datacenters');
CLI.prototype.do_info = require('./do_info');

// Account keys
CLI.prototype.do_key = require('./do_key');
CLI.prototype.do_keys = require('./do_keys');

// Firewall rules
CLI.prototype.do_fwrule = require('./do_fwrule');
CLI.prototype.do_fwrules = require('./do_fwrules');

// Images
CLI.prototype.do_images = require('./do_images');
CLI.prototype.do_image = require('./do_image');

// Instances (aka VMs/containers/machines)
CLI.prototype.do_instance = require('./do_instance');
CLI.prototype.do_instances = require('./do_instances');
CLI.prototype.do_create = require('./do_create');
CLI.prototype.do_delete = require('./do_delete');
CLI.prototype.do_start = require('./do_start');
CLI.prototype.do_stop = require('./do_stop');
CLI.prototype.do_reboot = require('./do_reboot');
CLI.prototype.do_ssh = require('./do_ssh');
CLI.prototype.do_ip = require('./do_ip');

// Packages
CLI.prototype.do_packages = require('./do_packages');
CLI.prototype.do_package = require('./do_package');

// Networks
CLI.prototype.do_networks = require('./do_networks');
CLI.prototype.do_network = require('./do_network');

// VLANs
CLI.prototype.do_vlan = require('./do_vlan');

// Hidden commands
CLI.prototype.do_cloudapi = require('./do_cloudapi');
CLI.prototype.do_badger = require('./do_badger');
CLI.prototype.do_rbac = require('./do_rbac');

// Volumes
CLI.prototype.do_volumes = require('./do_volumes');
CLI.prototype.do_volume = require('./do_volume');


//---- mainline

function main(argv) {
    if (!argv) {
        argv = process.argv;
    }

    var cli = new CLI();
    cli.main(argv, function (err) {
        var exitStatus = (err ? err.exitStatus || 1 : 0);
        var showErr = (cli.showErr !== undefined ? cli.showErr : true);
        var errHelp;
        var errMessage;

        if (err && showErr) {
            var code = (err.body ? err.body.code : err.code) || err.restCode;
            if (code === 'NoCommand') {
                /* jsl:pass */
            } else if (err.name === 'InternalServerError') {
                /*
                 * Internal server error, we want to provide a useful error
                 * message without exposing internals.
                 */
                console.error('%s: internal error. Please try again later, ' +
                    'and contact support in case the error persists.',
                    cmdln.nameFromErr(err));
            } else {
                /*
                 * If the err has `body.errors`, as some Triton/SDC APIs do per
                 *      // JSSTYLED
                 *      https://github.com/joyent/eng/blob/master/docs/index.md#error-handling
                 * then append a one-line summary for each error object.
                 */
                var bodyErrors = '';
                if (err.body && err.body.errors) {
                    err.body.errors.forEach(function (e) {
                        bodyErrors += format('\n    %s: %s', e.field, e.code);
                        if (e.message) {
                            bodyErrors += ': ' + e.message;
                        }
                    });
                }

                /*
                 * Try to find the most descriptive message to output.
                 *
                 * 1. If there's a message property on the error object, we
                 * assume this is suitable to output to the user.
                 *
                 * 2. Otherwise, if there's an "orignalBody" property, we output
                 * its content per joyent/node-triton#30.
                 *
                 * 3. We fall back to using the error's name as the error
                 * message.
                 */
                if (typeof (err.message) === 'string' && err.message !== '') {
                    errMessage = err.message;
                } else if (err.originalBody !== undefined) {
                    errMessage = err.originalBody.toString();
                } else {
                    errMessage = err.name;
                }

                console.error('%s: error%s: %s%s',
                    cmdln.nameFromErr(err),
                    (code ? format(' (%s)', code) : ''),
                    (cli.showErrStack ? err.stack : errMessage),
                    bodyErrors);
            }

            errHelp = cmdln.errHelpFromErr(err);
            if (errHelp) {
                console.error(errHelp);
            }
        }

        /*
         * We'd like to NOT use `process.exit` because that doesn't always
         * allow std handles to flush (e.g. all logging to complete). However
         * I don't know of another way to exit non-zero.
         */
        if (exitStatus !== 0) {
            process.exit(exitStatus);
        }
    });
}


//---- exports

module.exports = {
    CLI: CLI,
    main: main
};
