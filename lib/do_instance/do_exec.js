/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance reboot ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_exec(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('missing INST arg(s)'));
        return;
    } else if (args.length < 2) {
        cb(new errors.UsageError('missing CMD arg(s)'));
        return;
    }

    var id = args[0];
    var argv = args.slice(1);

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        tritonapi.getInstance({
            id: id,
            fields: ['id']
        }, function (lookupErr, inst) {
            if (lookupErr) {
                cb(lookupErr);
                return;
            }

            tritonapi.cloudapi.machineExec(inst.id, argv, function (err, res) {
                if (err) {
                    cb(err);
                    return;
                }
                res.forEach(function (evt) {
                    switch (evt.type) {
                    case 'stdout':
                        process.stdout.write(evt.data);
                        break;
                    case 'stderr':
                        process.stderr.write(evt.data);
                        break;
                    case 'end':
                        process.stdout.on('drain', function () {
                            process.exit(evt.data.code);
                        });
                    }
                });
            });
        });
    });
}


do_exec.synopses = ['{{name}} exec [OPTIONS] INST CMD'];
do_exec.help = [
    'Execute a command on an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');
do_exec.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_exec.completionArgtypes = ['tritoninstance'];



module.exports = do_exec;
