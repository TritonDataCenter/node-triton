/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance ssh ...`
 */

var path = require('path');
var spawn = require('child_process').spawn;

var common = require('../common');
var errors = require('../errors');


function do_ssh(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length === 0) {
        callback(new errors.UsageError('missing INST arg'));
        return;
    }

    var cli = this.top;
    var id = args.shift();

    var user = 'root';
    var i = id.indexOf('@');
    if (i >= 0) {
        user = id.substr(0, i);
        id = id.substr(i + 1);
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        cli.tritonapi.getInstance(id, function (err, inst) {
            if (err) {
                callback(err);
                return;
            }

            var ip = inst.primaryIp;
            if (!ip) {
                callback(new Error('primaryIp not found for instance'));
                return;
            }

            args = ['-l', user, ip].concat(args);

            /*
             * By default we disable ControlMaster (aka mux, aka SSH connection
             * multiplexing) because of
             * https://github.com/joyent/node-triton/issues/52
             *
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
                    cli.tritonapi.config._configDir, 'tmp',
                    'nullSshControlPath');
                args = [
                    '-o', 'ControlMaster=no',
                    '-o', 'ControlPath='+nullSshControlPath
                ].concat(args);
            }

            self.top.log.info({args: args}, 'forking ssh');
            var child = spawn('ssh', args, {stdio: 'inherit'});
            child.on('close', function (code) {
                /*
                 * Once node 0.10 support is dropped we could instead:
                 *      process.exitCode = code;
                 *      callback();
                 */
                process.exit(code);
            });
        });
    });
}

do_ssh.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];
do_ssh.synopses = ['{{name}} ssh [-h] INST [SSH-ARGUMENTS]'];
do_ssh.help = [
    /* BEGIN JSSTYLED */
    'SSH to the primary IP of an instance',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is the name, id, or short id of an instance. Note that',
    'the INST argument must come before any `ssh` options or arguments.',
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
