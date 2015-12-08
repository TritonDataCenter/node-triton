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

var common = require('../../lib/common');
var mod_triton = require('../../');
var testcommon = require('../lib/testcommon');



var CONFIG;
var configPath = process.env.TRITON_TEST_CONFIG
        ? path.resolve(process.cwd(), process.env.TRITON_TEST_CONFIG)
        : path.resolve(__dirname, '..', 'config.json');
try {
    CONFIG = require(configPath);
    assert.object(CONFIG, configPath);
    if (CONFIG.profile && CONFIG.profileName) {
        throw new Error(
            'cannot specify both "profile" and "profileName" in ' +
            configPath);
    } else if (CONFIG.profile) {
        assert.string(CONFIG.profile.url, 'CONFIG.profile.url');
        assert.string(CONFIG.profile.account, 'CONFIG.profile.account');
        assert.string(CONFIG.profile.keyId, 'CONFIG.profile.keyId');
        assert.optionalBool(CONFIG.profile.insecure,
            'CONFIG.profile.insecure');
    } else if (CONFIG.profileName) {
        CONFIG.profile = mod_triton.loadProfile({
            configDir: path.join(process.env.HOME, '.triton'),
            name: CONFIG.profileName
        });
    } else {
        throw new Error('one of "profile" or "profileName" must be defined ' +
            'in ' + configPath);
    }
    assert.optionalBool(CONFIG.allowWriteActions,
        'test/config.json#allowWriteActions');
} catch (e) {
    error('* * *');
    error('node-triton integration tests require a config file. By default');
    error('it looks for "test/config.json". Or you can set the');
    error('TRITON_TEST_CONFIG envvar. E.g.:');
    error('');
    error('    TRITON_TEST_CONFIG=test/coal.json make test');
    error('');
    error('See "test/config.json.sample" for a starting point for a config.');
    error('');
    error('Warning: This test suite will create machines, images, etc. ');
    error('using this CloudAPI and account. While it will do its best');
    error('to clean up all resources, running the test suite against');
    error('a public cloud could *cost* you money. :)');
    error('* * *');
    throw e;
}
if (CONFIG.profile.insecure === undefined)
    CONFIG.profile.insecure = false;
if (CONFIG.allowWriteActions === undefined)
    CONFIG.allowWriteActions = false;

var TRITON = [process.execPath, path.resolve(__dirname, '../../bin/triton')];
var UA = 'node-triton-test';

var LOG = require('../lib/log');



/*
 * Call the `triton` CLI with the given args.
 *
 * @param args {String|Array} Required. CLI arguments to `triton ...` (without
 *      the "triton"). This can be an array of args, or a string.
 * @param opts {Object} Optional.
 *      - opts.cwd {String} cwd option to exec.
 * @param cb {Function}
 */
function triton(args, opts, cb) {
    var command = [].concat(TRITON).concat(args);
    if (typeof (args) === 'string')
        command = command.join(' ');
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.object(opts, 'opts');
    assert.optionalString(opts.cwd, 'opts.cwd');
    assert.func(cb, 'cb');

    testcommon.execPlus({
        command: command,
        execOpts: {
            maxBuffer: Infinity,
            env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
                TRITON_PROFILE: 'env',
                TRITON_URL: CONFIG.profile.url,
                TRITON_ACCOUNT: CONFIG.profile.account,
                TRITON_KEY_ID: CONFIG.profile.keyId,
                TRITON_TLS_INSECURE: CONFIG.profile.insecure
            },
            cwd: opts.cwd
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


/*
 * Create a TritonApi client using the CLI.
 */
function createClient() {
    return mod_triton.createClient({
        log: LOG,
        profile: CONFIG.profile,
        configDir: '~/.triton'   // piggy-back on Triton CLI config dir
    });
}


// --- exports

module.exports = {
    CONFIG: CONFIG,
    triton: triton,
    safeTriton: safeTriton,
    createClient: createClient,
    ifErr: testcommon.ifErr
};
