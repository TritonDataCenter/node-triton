/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var assert = require('assert-plus');
var execFile = require('child_process').execFile;
var VError = require('verror').VError;



// ---- exports

/**
 * A convenience wrapper around `child_process.exec` to take away some
 * logging and error handling boilerplate.
 *
 * @param args {Object}
 *      - command {String|Array} Required.
 *      - log {Bunyan Logger} Required. Use to log details at trace level.
 *      - execOpts {Array} Optional. child_process.exec options.
 *      - errMsg {String} Optional. Error string to use in error message on
 *        failure.
 * @param cb {Function} `function (err, stdout, stderr)` where `err` here is
 *      an `VError` wrapper around the child_process error.
 */
function execPlus(args, cb) {
    assert.object(args, 'args');
    assert.optionalString(args.errMsg, 'args.errMsg');
    assert.optionalObject(args.execOpts, 'args.execOpts');
    assert.object(args.log, 'args.log');
    assert.func(cb);
    var command = args.command;
    var execOpts = args.execOpts;
    if (typeof (command) === 'string')
        command = ['/bin/sh', '-c', command];

    execFile(command[0], command.slice(1), execOpts,
        function (err, stdout, stderr) {
        args.log.trace({exec: true, command: command, execOpts: execOpts,
            err: err, stdout: stdout, stderr: stderr}, 'exec done');
        if (err) {
            var niceErr = new VError(err,
                    '%s:\n'
                    + '\tcommand: %s\n'
                    + '\texit status: %s\n'
                    + '\tstdout:\n%s\n'
                    + '\tstderr:\n%s',
                    args.errMsg || 'exec error', command, err.code,
                    stdout.trim(), stderr.trim());
            niceErr.code = err.code;
            cb(niceErr, stdout, stderr);
        } else {
            cb(null, stdout, stderr);
        }
    });
}



/**
 * Calls t.ifError, outputs the error body for diagnostic purposes, and
 * returns true if there was an error
 */
function ifErr(t, err, desc) {
    t.ifError(err, desc);
    if (err) {
        t.deepEqual(err.body, {}, desc + ': error body');
        return true;
    }

    return false;
}


module.exports = {
    execPlus: execPlus,
    ifErr: ifErr
};
