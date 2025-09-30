/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Joyent, Inc.
 *
 * `triton instance console ...`
 */

var tty = require('tty');
var common = require('../common');
var errors = require('../errors');

function do_console(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length === 0) {
        callback(new errors.UsageError('missing INST arg'));
        return;
    }

    var id = args.shift();
    var tritonapi = this.top.tritonapi;
    var stdinWasRaw = false;
    var stdinOldMode;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
            return;
        }

        console.log('Connecting to console... (Ctrl-] to disconnect)');

        tritonapi.getInstanceConsole(id, function consoleCb(consoleErr, shed) {
            if (consoleErr) {
                callback(consoleErr);
                return;
            }

            // Put stdin in raw mode if it's a TTY
            if (tty.isatty(process.stdin.fd)) {
                stdinWasRaw = process.stdin.isRaw;
                stdinOldMode = process.stdin.setRawMode;
                process.stdin.setRawMode(true);
                process.stdin.resume();
            }

            // Disable stdout buffering
            if (process.stdout._handle && process.stdout._handle.setBlocking) {
                process.stdout._handle.setBlocking(true);
            }

            // Forward stdin to WebSocket
            process.stdin.on('data', function (data) {
                // Check for escape sequence: Ctrl-] (ASCII 0x1d)
                if (data.length === 1 && data[0] === 0x1d) {
                    console.log('\n[Disconnecting...]');
                    cleanup();
                    callback();
                    return;
                }
                shed.send(data);
            });

            // Forward WebSocket to stdout
            shed.on('binary', function (data) {
                process.stdout.write(data);
            });

            shed.on('text', function (text) {
                process.stdout.write(text);
            });

            shed.on('end', function (code, reason) {
                console.log('\n[Console connection closed]');
                cleanup();
                callback();
            });

            shed.on('error', function (shedErr) {
                console.error('\n[Console error: ' + shedErr.message + ']');
                cleanup();
                callback(shedErr);
            });

            shed.on('connectionReset', function () {
                console.log('\n[Connection reset by peer]');
                cleanup();
                callback();
            });

            // Handle process signals
            process.on('SIGINT', function () {
                console.log('\n[Interrupted]');
                cleanup();
                callback();
            });

            process.on('SIGTERM', function () {
                console.log('\n[Terminated]');
                cleanup();
                callback();
            });

            function cleanup() {
                // Restore stdin mode
                if (stdinWasRaw !== undefined && process.stdin.setRawMode) {
                    process.stdin.setRawMode(stdinWasRaw);
                }

                // Close WebSocket
                if (shed && !shed.destroyed) {
                    try {
                        shed.end();
                    } catch (e) {
                        // Ignore errors during cleanup
                    }
                }

                // Remove stdin listeners
                process.stdin.removeAllListeners('data');
                process.stdin.pause();
            }
        });
    });
}

do_console.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_console.synopses = ['{{name}} console [OPTIONS] INST'];
do_console.help = [
    'Connect to instance console.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Connect to the serial console (for KVM instances) or zone console',
    '(for other instance types). This provides low-level access to the',
    'instance, useful for troubleshooting boot issues or network problems.',
    '',
    'Press Ctrl-] to disconnect from the console.',
    '',
    'Where INST is an instance name, id, or short id.',
    '',
    'Note: Not all instance types support console access. KVM and Bhyve',
    'instances provide serial console access. SmartOS containers provide',
    'zone console access.'
].join('\n');

do_console.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_console;
