/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for the integration tests
 */

var error = console.error;
var assert = require('assert-plus');
var f = require('util').format;
var path = require('path');

var mod_config = require('../../lib/config');

var testcommon = require('../lib/testcommon');


// --- globals

var CONFIG;
if (process.env.TRITON_TEST_PROFILE) {
    CONFIG = mod_config.loadProfile({
        configDir: path.join(process.env.HOME, '.triton'),
        name: process.env.TRITON_TEST_PROFILE
    });
    CONFIG.destructiveAllowed = !!process.env.TRITON_TEST_DESTRUCTIVE_ALLOWED;
} else {
    try {
        CONFIG = require('../config.json');
        assert.object(CONFIG, 'test/config.json');
        assert.string(CONFIG.url, 'test/config.json#url');
        assert.string(CONFIG.account, 'test/config.json#account');
        assert.string(CONFIG.keyId, 'test/config.json#keyId');
        assert.optionalBool(CONFIG.insecure,
            'test/config.json#insecure');
        assert.optionalBool(CONFIG.destrectiveAllowed,
            'test/config.json#destructiveAllowed');
    } catch (e) {
        error('* * *');
        error('node-triton integration tests require a ./test/config.json');
        error('or TRITON_TEST_PROFILE to be set to a profile');
        error('');
        error('    {');
        error('        "url": "<CloudAPI URL>",');
        error('        "account": "<account>",');
        error('        "keyId": "<ssh key fingerprint>",');
        error('        "insecure": true|false,  // optional');
        error('        "destructiveAllowed": true|false  // optional');
        error('    }');
        error('');
        error('Note: This test suite with create machines, images, etc. using');
        error('this CloudAPI and account. That could *cost* you money. :)');
        error('* * *');
        throw e;
    }
}
if (CONFIG.insecure === undefined)
    CONFIG.insecure = false;
if (CONFIG.destructiveAllowed === undefined)
    CONFIG.destructiveAllowed = false;

var TRITON = [process.execPath, path.resolve(__dirname, '../../bin/triton')];
var UA = 'node-triton-test';

var LOG = require('../lib/log');



// --- internal support routines

/*
 * Call the `triton` CLI with the given args.
 */
function triton(args, cb) {
    var command = [].concat(TRITON).concat(args);
    if (typeof (args) === 'string')
        command = command.join(' ');

    testcommon.execPlus({
        command: command,
        execOpts: {
            maxBuffer: Infinity,
            env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
                TRITON_PROFILE: 'env',
                TRITON_URL: CONFIG.url,
                TRITON_ACCOUNT: CONFIG.account,
                TRITON_KEY_ID: CONFIG.keyId,
                TRITON_TLS_INSECURE: CONFIG.insecure
            }
        },
        log: LOG
    }, cb);
}

/*
 * triton wrapper that:
 * - tests no error is present
 * - tests stdout is not empty
 * - tests stderr is empty
 *
 * In the event that any of the above is false, this function will NOT
 * fire the callback, which will result in the early terminate of these
 * tests as `t.end()` will never be called.
 *
 * @param {Tape} t - tape test object
 * @param {Object|Array} opts - options object
 * @param {Function} cb - callback called like "cb(stdout)"
 */
function safeTriton(t, opts, cb) {
    if (Array.isArray(opts)) {
        opts = {args: opts};
    }
    t.comment(f('running: triton %s', opts.args.join(' ')));
    triton(opts.args, function (err, stdout, stderr) {
        t.error(err, 'no error running child process');
        t.equal(stderr, '', 'no stderr produced');
        t.notEqual(stdout, '', 'stdout produced');

        if (opts.json) {
            try {
                stdout = JSON.parse(stdout);
            } catch (e) {
                t.fail('failed to parse JSON');
                return;
            }
        }

        if (!err && stdout && !stderr)
            cb(stdout);
    });
}


// --- exports

module.exports = {
    CONFIG: CONFIG,
    triton: triton,
    safeTriton: safeTriton,
    ifErr: testcommon.ifErr
};
