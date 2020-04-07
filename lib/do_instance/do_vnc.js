/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton instance vnc ...`
 */

var net = require('net');
var vasync = require('vasync');
var common = require('../common');
var errors = require('../errors');
var format = require('util').format;

function startServer(port, cb) {
    var server = net.createServer(function (conn) {
        cb(null, conn);
    });

    server.listen(port);

    server.on('listening', function () {
        var lport = server.address().port;
        var connstr = format('vnc://127.0.0.1:%d', lport);
        console.log('Listening on ' + connstr);
    });

    server.on('error', function (err) {
        cb(err);
    });
}

function do_vnc(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length === 0) {
        callback(new errors.UsageError('missing INST arg'));
        return;
    }

    var id = args.shift();
    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
            return;
        }

        start_server(opts.port || 0, function (svrErr, conn) {
            if (svrErr) {
                callback(svrErr);
                return;
            }

            conn.setNoDelay(true);

            tritonapi.getInstanceVnc(id, function (vncErr, shed) {
                if (vncErr) {
                    callback(vncErr);
                    return;
                }

                conn.on('data', function (data) {
                    shed.send(data);
                });

                shed.on('binary', function (data) {
                    conn.write(data);
                });

                conn.on('end', function (data) {
                    callback();
                });

                shed.on('end', function (code, reason) {
                    conn.end();
                    callback();
                });

                shed.on('error', function (shedErr) {
                    conn.end();
                    callback(shedErr);
                });

                shed.on('connectionReset', function () {
                    console.log('Connect reset by peer');
                    conn.end();
                    callback();
                });
            });
        });
    });
}

do_vnc.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['port', 'p'],
        helpArg: 'PORT',
        type: 'positiveInteger',
        help: 'The port number the server listens on.  If not specified, '
            + 'a random port number is used.'
    }
];

do_vnc.synopses = ['{{name}} vnc [OPTIONS] INST'];
do_vnc.help = [
    'Start VNC server for instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance name, id, or short id.'
].join('\n');

do_vnc.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_vnc;
