/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance vnc ...`
 */

var net = require('net');
var vasync = require('vasync');
var common = require('../common');
var errors = require('../errors');
var format = require('util').format;

function getInstance(ctx, next) {
    ctx.cli.tritonapi.getInstance(ctx.id, function onInstance(err, inst) {
        if (err) {
            next(err);
            return;
        }

        ctx.inst = inst;
        next();
    });
}

function createServer(port, cb) {
    var server = net.createServer(function (conn) {
        cb(null, conn);
    });

    server.listen(port);

    server.on('listening', function serverListen() {
        var actualPort = server.address().port;
        var connstr = format('vnc://127.0.0.1:%d', actualPort);
        console.log('Listening on ' + connstr);
    });

    server.on('error', function serverError(err) {
        cb(err);
    });
}

function startProxy(ctx, next) {
    createServer(ctx.port, function onConnect(cErr, conn) {
        if (cErr) {
            next(cErr);
            return;
        }

        // VNC is latency sensitive, so send data as soon as it's available
        conn.setNoDelay(true);

        // The VNC protocol starts with the _server_ sending a handshake
        // to the client, so we explicitly want to defer creation of the
        // websocket until we have a connection on the proxy
        ctx.cli.tritonapi.getInstanceVnc(ctx.inst.id, function vnc(vErr, shed) {
            conn.on('data', function serverData(data) {
                shed.send(data);
            });

            shed.on('binary', function shedData(data) {
                conn.write(data);
            });

            conn.on('end', function serverEnd(data) {
                console.log('# Connection closed');
                shed.end('Connection closed');
                process.exit(0);
            });

            shed.on('end', function shedEnd(code, reason) {
                conn.end();
                var msg = format('# Websocket closed: %d - %s', code, reason);
                console.log(msg);
                process.exit(0);
            });

            shed.on('error', function shedError(shedErr) {
                conn.end();
                if (shedErr) {
                    console.log('# Websocket error: ', shedErr);
                }
                // A shed 'end' event will follow this
            });

            shed.on('connectionReset', function shedReset() {
                console.log('# Connection reset by peer');
                conn.end();
                // A shed 'end' event will follow this
            });
        });
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
    var port = opts.port || 0;

    vasync.pipeline({arg: {cli: this.top, id: id, port: port}, funcs: [
        common.cliSetupTritonApi,

        // We could skip the instance lookup here and directly call
        // tritonapi.getInstanceVnc with 'id', however, the instance id given
        // would not be validated until a connection is made to the server
        // proxy we create with start_server.  Instead the id is validated
        // before we start the proxy so that we can immediately exit if
        // there is an error.
        getInstance,
        startProxy
    ]}, callback);
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
