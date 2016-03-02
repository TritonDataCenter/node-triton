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

var spawn = require('child_process').spawn;

var common = require('../common');


function do_ssh(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length === 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    var id = args.shift();

    var user = 'root';
    var i = id.indexOf('@');
    if (i >= 0) {
        user = id.substr(0, i);
        id = id.substr(i + 1);
    }

    this.top.tritonapi.getInstance(id, function (err, inst) {
        if (err) {
            callback(err);
            return;
        }

        var ip = inst.primaryIp;
        if (!ip) {
            callback(new Error('primaryIp not found for instance'));
            return;
        }

        args = ['-l', user].concat(ip).concat(args);

        self.top.log.info({args: args}, 'forking ssh');
        var child = spawn('ssh', args);
        child.stdout.on('data', function (chunk) {
            process.stdout.write(chunk);
        });
        child.stderr.on('data', function (chunk) {
            process.stderr.write(chunk);
        });
        child.on('close', function (code) {
            /*
             * Once node 0.10 support is dropped we could instead:
             *      process.exitCode = code;
             *      callback();
             */
            process.exit(code);
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
do_ssh.help = (
    'SSH to the primary IP of an instance\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} ssh <alias|id> [arguments]\n'
    + '\n'
    + '{{options}}'
);

do_ssh.interspersedOptions = false;

module.exports = do_ssh;
