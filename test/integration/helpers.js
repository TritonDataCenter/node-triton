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
var tabula = require('tabula');

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
 * `triton ...` wrapper that:
 * - tests non-error exit
 * - tests stderr is empty
 *
 * @param {Tape} t - tape test object
 * @param {Object|Array} opts - options object, or just the `triton` args
 * @param {Function} cb - `function (err, stdout)`
 */
function safeTriton(t, opts, cb) {
    assert.object(t, 't');
    if (Array.isArray(opts)) {
        opts = {args: opts};
    }
    assert.object(opts, 'opts');
    assert.arrayOfString(opts.args, 'opts.args');
    assert.optionalBool(opts.json, 'opts.json');
    assert.func(cb, 'cb');

    // t.comment(f('running: triton %s', opts.args.join(' ')));
    triton(opts.args, function (err, stdout, stderr) {
        t.error(err, f('ran "triton %s", err=%s', opts.args.join(' '), err));
        t.equal(stderr, '', 'empty stderr');
        if (opts.json) {
            try {
                stdout = JSON.parse(stdout);
            } catch (e) {
                t.fail('failed to parse JSON');
                return;
            }
        }
        cb(err, stdout);
    });
}


/*
 * Find and return an image that can be used for test provisions. We look
 * for an available base or minimal image.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, imgId)`
 *      where `imgId` is an image identifier (an image name, shortid, or id).
 */
function getTestImg(t, cb) {
    if (CONFIG.image) {
        t.ok(CONFIG.image, 'image from config: ' + CONFIG.image);
        cb(null, CONFIG.image);
        return;
    }

    var candidateImageNames = {
        'base-64-lts': true,
        'base-64': true,
        'minimal-64': true,
        'base-32-lts': true,
        'base-32': true,
        'minimal-32': true,
        'base': true
    };
    safeTriton(t, ['img', 'ls', '-j'], function (err, stdout) {
        var imgId;
        var imgs = jsonStreamParse(stdout);
        // Newest images first.
        tabula.sortArrayOfObjects(imgs, ['-published_at']);
        var imgRepr;
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if (candidateImageNames[img.name]) {
                imgId = img.id;
                imgRepr = f('%s@%s', img.name, img.version);
                break;
            }
        }

        t.ok(imgId, f('latest available base/minimal image: %s (%s)',
            imgId, imgRepr));
        cb(err, imgId);
    });
}


/*
 * Find and return an package that can be used for test provisions.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, pkgId)`
 *      where `pkgId` is an package identifier (a name, shortid, or id).
 */
function getTestPkg(t, cb) {
    if (CONFIG.package) {
        t.ok(CONFIG.package, 'package from config: ' + CONFIG.package);
        cb(null, CONFIG.package);
        return;
    }

    safeTriton(t, ['pkg', 'ls', '-j'], function (err, stdout) {
        var pkgs = jsonStreamParse(stdout);
        // Smallest RAM first.
        tabula.sortArrayOfObjects(pkgs, ['memory']);
        var pkgId = pkgs[0].id;
        t.ok(pkgId, f('smallest (RAM) available package: %s (%s)',
            pkgId, pkgs[0].name));
        cb(null, pkgId);
    });
}


function jsonStreamParse(s) {
    var results = [];
    var lines = s.trim().split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) {
            results.push(JSON.parse(line));
        }
    }
    return results;
}


/*
 * Create a TritonApi client using the CLI.
 */
function createClient(cb) {
    assert.func(cb, 'cb');

    mod_triton.createClient({
        log: LOG,
        profile: CONFIG.profile,
        configDir: '~/.triton'   // piggy-back on Triton CLI config dir
    }, cb);
}


/*
 * Create a small test instance.
 */
function createTestInst(t, name, cb) {
    getTestPkg(t, function (err, pkgId) {
        t.ifErr(err);
        if (err) {
            cb(err);
            return;
        }

        getTestImg(t, function (err2, imgId) {
            t.ifErr(err2);
            if (err2) {
                cb(err2);
                return;
            }

            var cmd = f('instance create -w -n %s %s %s', name, imgId, pkgId);
            triton(cmd, function (err3, stdout) {
                t.ifErr(err3, 'create test instance');
                if (err3) {
                    cb(err3);
                    return;
                }

                var match = stdout.match(/Created .+? \((.+)\)/);
                var inst = match[1];

                cb(null, inst);
            });
        });
    });
}


/*
 * Remove test instance, if exists.
 */
function deleteTestInst(t, name, cb) {
    triton(['inst', 'get', '-j', name], function (err, stdout, stderr) {
        if (err) {
            if (err.code === 3) {  // `triton` code for ResourceNotFound
                t.ok(true, 'no pre-existing alias in the way');
            } else {
                t.ifErr(err);
            }

            return cb();
        }

        var oldInst = JSON.parse(stdout);

        safeTriton(t, ['delete', '-w', oldInst.id], function (dErr) {
            t.ifError(dErr, 'deleted old inst ' + oldInst.id);
            cb();
        });
    });
}


/*
 * Print out a listing of the test config.json values.
 */
function printConfig(t) {
    t.comment('Test config:');

    Object.keys(CONFIG).forEach(function (key) {
        var value = CONFIG[key];
        t.comment(f('- %s: %j', key, value));
    });
}


// --- exports

module.exports = {
    CONFIG: CONFIG,
    triton: triton,
    safeTriton: safeTriton,
    createClient: createClient,
    createTestInst: createTestInst,
    deleteTestInst: deleteTestInst,
    getTestImg: getTestImg,
    getTestPkg: getTestPkg,
    jsonStreamParse: jsonStreamParse,
    printConfig: printConfig,

    ifErr: testcommon.ifErr
};
