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
var path = require('path');

var testcommon = require('../lib/testcommon');



// --- globals

try {
    var CONFIG = require('../config.json');
    assert.object(CONFIG, 'test/config.json');
    assert.string(CONFIG.url, 'test/config.json#url');
    assert.string(CONFIG.account, 'test/config.json#account');
    assert.string(CONFIG.keyId, 'test/config.json#keyId');
    if (CONFIG.insecure === undefined)
        CONFIG.insecure = false;
    if (CONFIG.destructiveAllowed === undefined)
        CONFIG.destructiveAllowed = false;
    assert.bool(CONFIG.insecure, 'test/config.json#destructiveAllowed');
} catch (e) {
    error('* * *');
    error('node-triton integration tests require a ./test/config.json');
    error('');
    error('    {');
    error('        "url": "<CloudAPI URL>",');
    error('        "account": "<account>",');
    error('        "keyId": "<ssh key fingerprint>",');
    error('        "insecure": true|false   // optional');
    error('    }');
    error('');
    error('Note: This test suite with create machines, images, et al using');
    error('this CloudAPI and account. That could *cost* you money. :)');
    error('* * *');
    throw e;
}

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
                SDC_URL: CONFIG.url,
                SDC_ACCOUNT: CONFIG.account,
                SDC_KEY_ID: CONFIG.keyId,
                SDC_TLS_INSECURE: CONFIG.insecure
            }
        },
        log: LOG
    }, cb);
}


// --- exports

module.exports = {
    CONFIG: CONFIG,
    triton: triton,
    ifErr: testcommon.ifErr
};
