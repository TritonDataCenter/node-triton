/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton ssh ...`
 */

var common = require('./common');
var spawn = require('child_process').spawn;

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

    this.triton.getInstance(id, function (err, inst) {
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

        self.triton.log.info({args: args}, 'forking ssh');
        var child = spawn('ssh', args, {stdio: 'inherit'});
        child.on('close', function (code) {
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
