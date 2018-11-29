/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 *
 * `triton instance ssh ...`
 */

var assert = require('assert-plus');
var path = require('path');
var spawn = require('child_process').spawn;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');

/*
 * The tag "tritoncli.ssh.ip" may be set to an IP address that belongs to the
 * instance but which is not the primary IP.  If set, we will use that IP
 * address for the SSH connection instead of the primary IP.
 */
var TAG_SSH_IP = 'tritoncli.ssh.ip';

/*
 * The tag "tritoncli.ssh.proxy" may be set to either the name or the UUID of
 * another instance in this account.  If set, we will use the "ProxyJump"
 * feature of SSH to tunnel through the SSH server on that host.  This is
 * useful when exposing a single zone to the Internet while keeping the rest of
 * your infrastructure on a private fabric.
 */
var TAG_SSH_PROXY = 'tritoncli.ssh.proxy';

/*
 * The tag "tritoncli.ssh.proxyuser" may be set on the instance used as an SSH
 * proxy.  If set, we will use this value when making the proxy connection
 * (i.e., it will be passed via the "ProxyJump" option).  If not set, the
 * default user selection behaviour applies.
 */
var TAG_SSH_PROXY_USER = 'tritoncli.ssh.proxyuser';


function do_ssh(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length === 0) {
        callback(new errors.UsageError('missing INST arg'));
        return;
    }

    var id = args.shift();

    var user;
    var overrideUser = false;
    var i = id.indexOf('@');
    if (i >= 0) {
        user = id.substr(0, i);
        id = id.substr(i + 1);
        overrideUser = true;
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        function getInstanceIp(ctx, next) {
            ctx.cli.tritonapi.getInstance(id, function (err, inst) {
                if (err) {
                    next(err);
                    return;
                }

                ctx.inst = inst;

                if (inst.tags && inst.tags[TAG_SSH_IP]) {
                    ctx.ip = inst.tags[TAG_SSH_IP];
                    if (!inst.ips || inst.ips.indexOf(ctx.ip) === -1) {
                        next(new Error('IP address ' + ctx.ip + ' not ' +
                            'attached to the instance'));
                        return;
                    }
                } else {
                    ctx.ip = inst.primaryIp;
                }

                if (!ctx.ip) {
                    next(new Error('IP address not found for instance'));
                    return;
                }
                next();
            });
        },

        function getInstanceBastionIp(ctx, next) {
            if (opts.no_proxy) {
                setImmediate(next);
                return;
            }

            if (!ctx.inst.tags || !ctx.inst.tags[TAG_SSH_PROXY]) {
                setImmediate(next);
                return;
            }

            ctx.cli.tritonapi.getInstance(ctx.inst.tags[TAG_SSH_PROXY],
                function (err, proxy) {

                if (err) {
                    next(err);
                    return;
                }

                if (proxy.tags && proxy.tags[TAG_SSH_IP]) {
                    ctx.proxyIp = proxy.tags[TAG_SSH_IP];
                    if (!proxy.ips || proxy.ips.indexOf(ctx.proxyIp) === -1) {
                        next(new Error('IP address ' + ctx.proxyIp + ' not ' +
                            'attached to the instance'));
                        return;
                    }
                } else {
                    ctx.proxyIp = proxy.primaryIp;
                }

                ctx.proxyImage = proxy.image;

                /*
                 * Selecting the right user to use for the proxy connection is
                 * somewhat nuanced, in order to allow for various useful
                 * configurations.  We wish to enable the following cases:
                 *
                 * 1. The least sophisticated configuration; i.e., using two
                 *    instances (the target instance and the proxy instnace)
                 *    with the default "root" (or, e.g., "ubuntu") account
                 *    and smartlogin or authorized_keys metadata for SSH key
                 *    management.
                 *
                 * 2. The user has set up their own accounts (e.g., "roberta")
                 *    in all of their instances and does their own SSH key
                 *    management.  They connect with:
                 *
                 *        triton inst ssh roberta@instance
                 *
                 *    In this case we will use "roberta" for both the proxy
                 *    and the target instance.  This means a user provided on
                 *    the command line will override the per-image default
                 *    user (e.g., "root" or "ubuntu") -- if the user wants to
                 *    retain the default account for the proxy, they should
                 *    use case 3 below.
                 *
                 * 3. The user has set up their own accounts in the target
                 *    instance (e.g., "felicity"), but the proxy instance is
                 *    using a single specific account that should be used by
                 *    all users in the organisation (e.g., "partyline").  In
                 *    this case, we want the user to be able to specify the
                 *    global proxy account setting as a tag on the proxy
                 *    instance, so that for:
                 *
                 *        triton inst ssh felicity@instance
                 *
                 *    ... we will use "-o ProxyJump partyline@proxy" but
                 *    still use "felicity" for the target connection.  This
                 *    last case requires the proxy user tag (if set) to
                 *    override a user provided on the command line.
                 */
                if (proxy.tags && proxy.tags[TAG_SSH_PROXY_USER]) {
                    ctx.proxyUser = proxy.tags[TAG_SSH_PROXY_USER];
                }

                if (!ctx.proxyIp) {
                    next(new Error('IP address not found for proxy instance'));
                    return;
                }

                next();
            });
        },

        function getUser(ctx, next) {
            if (overrideUser) {
                assert.string(user, 'user');
                next();
                return;
            }

            ctx.cli.tritonapi.getImage({
                name: ctx.inst.image,
                useCache: true
            }, function (getImageErr, image) {
                if (getImageErr) {
                    next(getImageErr);
                    return;
                }

                /*
                 * This is a convention as seen on Joyent's "ubuntu-certified"
                 * KVM images.
                 */
                if (image.tags && image.tags.default_user) {
                    user = image.tags.default_user;
                } else {
                    user = 'root';
                }

                next();
            });
        },

        function getBastionUser(ctx, next) {
            if (!ctx.proxyImage || ctx.proxyUser) {
                /*
                 * If there is no image for the proxy host, or an override user
                 * was already provided in the tags of the proxy instance
                 * itself, we don't need to look up the default user.
                 */
                next();
                return;
            }

            if (overrideUser) {
                /*
                 * A user was provided on the command line, but no user
                 * override tag was present on the proxy instance.  To enable
                 * use case 2 (see comments above) we'll prefer this user over
                 * the image default.
                 */
                assert.string(user, 'user');
                ctx.proxyUser = user;
                next();
                return;
            }

            ctx.cli.tritonapi.getImage({
                name: ctx.proxyImage,
                useCache: true
            }, function (getImageErr, image) {
                if (getImageErr) {
                    next(getImageErr);
                    return;
                }

                /*
                 * This is a convention as seen on Joyent's "ubuntu-certified"
                 * KVM images.
                 */
                assert.ok(!ctx.proxyUser, 'proxy user set twice');
                if (image.tags && image.tags.default_user) {
                    ctx.proxyUser = image.tags.default_user;
                } else {
                    ctx.proxyUser = 'root';
                }

                next();
            });
        },

        function doSsh(ctx, next) {
            args = ['-l', user, ctx.ip].concat(args);

            if (ctx.proxyIp) {
                assert.string(ctx.proxyUser, 'ctx.proxyUser');
                args = [
                    '-o', 'ProxyJump=' + ctx.proxyUser + '@' + ctx.proxyIp
                ].concat(args);
            }

            /*
             * By default we disable ControlMaster (aka mux, aka SSH
             * connection multiplexing) because of
             * https://github.com/joyent/node-triton/issues/52
             */
            if (!opts.no_disable_mux) {
                /*
                 * A simple `-o ControlMaster=no` doesn't work. With
                 * just that option, a `ControlPath` option (from
                 * ~/.ssh/config) will still be used if it exists. Our
                 * hack is to set a ControlPath we know should not
                 * exist. Using '/dev/null' wasn't a good alternative
                 * because `ssh` tries "$ControlPath.$somerandomnum"
                 * and also because Windows.
                 */
                var nullSshControlPath = path.resolve(
                    ctx.cli.tritonapi.config._configDir, 'tmp',
                    'nullSshControlPath');
                args = [
                    '-o', 'ControlMaster=no',
                    '-o', 'ControlPath='+nullSshControlPath
                ].concat(args);
            }

            ctx.cli.log.info({args: args}, 'forking ssh');
            var child = spawn('ssh', args, {stdio: 'inherit'});
            child.on('close', function (code) {
                /*
                 * Once node 0.10 support is dropped we could instead:
                 *      process.exitCode = code;
                 *      callback();
                 */
                process.exit(code);
                /* process.exit does not return so no need to call next(). */
            });
        }
    ]}, callback);
}

do_ssh.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['no-proxy'],
        type: 'bool',
        help: 'Disable SSH proxy support (ignore "tritoncli.ssh.proxy" tag)'
    }
];
do_ssh.synopses = ['{{name}} ssh [-h] [USER@]INST [SSH-ARGUMENTS]'];
do_ssh.help = [
    /* BEGIN JSSTYLED */
    'SSH to the primary IP of an instance',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is the name, id, or short id of an instance. Note that',
    'the INST argument must come before any `ssh` options or arguments.',
    'Where USER is the username to use on the instance. If not specified,',
    'the instance\'s image is inspected for the default_user tag.',
    'If USER is not specified and the default_user tag is not set, the user',
    'is assumed to be \"root\".',
    '',
    'The "tritoncli.ssh.proxy" tag on the target instance may be set to',
    'the name or the UUID of another instance through which to proxy this',
    'SSH connection.  If set, the primary IP of the proxy instance will be',
    'loaded and passed to SSH via the ProxyJump option.  The --no-proxy',
    'flag can be used to ignore the tag and force a direct connection.',
    '',
    'For example, to proxy connections to zone "narnia" through "wardrobe":',
    '    triton instance tag set narnia tritoncli.ssh.proxy=wardrobe',
    '',
    'The "tritoncli.ssh.ip" tag on the target instance may be set to the',
    'IP address to use for SSH connections.  This may be useful if the',
    'primary IP address is not available for SSH connections.  This address',
    'must be set to one of the IP addresses attached to the instance.',
    '',
    'The "tritoncli.ssh.proxyuser" tag on the proxy instance may be set to',
    'the user account that should be used for the proxy connection (i.e., via',
    'the SSH ProxyJump option).  This is useful when all users of the proxy',
    'instance should use a special common account, and will override the USER',
    'value (if one is provided) for the SSH connection to the target instance.',
    '',
    'There is a known issue with SSH connection multiplexing (a.k.a. ',
    'ControlMaster, mux) where stdout/stderr is lost. As a workaround, `ssh`',
    'is spawned with options disabling ControlMaster. See ',
    '<https://github.com/joyent/node-triton/issues/52> for details. If you ',
    'want to use ControlMaster, an alternative is:',
    '    ssh root@$(triton ip INST)'
    /* END JSSTYLED */
].join('\n');

do_ssh.interspersedOptions = false;

// Use 'file' to fallback to the default bash completion... even though 'file'
// isn't quite right.
do_ssh.completionArgtypes = ['tritoninstance', 'file'];

module.exports = do_ssh;
