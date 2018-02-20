/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 */

/*
 * Test helpers for the integration tests
 */

var assert = require('assert-plus');
var error = console.error;
var f = require('util').format;
var os = require('os');
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
 *      Note that `err` will already have been tested to be falsey via
 *      `t.error(err, ...)`, so it may be fine for the calling test case
 *      to ignore `err`.
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
 * Find and return an image that can be used for test *bhyve* provisions.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, imgId)`
 *      where `imgId` is an image identifier (an image name, shortid, or id).
 */
function getTestBhyveImg(t, cb) {
    if (CONFIG.bhyveImage) {
        assert.string(CONFIG.bhyvePackage, 'CONFIG.bhyvePackage');
        t.ok(CONFIG.bhyveImage, 'bhyveImage from config: ' + CONFIG.bhyveImage);
        cb(null, CONFIG.bhyveImage);
        return;
    }

    var candidateImageNames = {
        'ubuntu-certified-16.04': true
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

        t.ok(imgId,
            f('latest bhyve image (using subset of supported names): %s (%s)',
            imgId, imgRepr));
        cb(err, imgId);
    });
}

/*
 * Find and return an image that can be used for test *KVM* provisions.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, imgId)`
 *      where `imgId` is an image identifier (an image name, shortid, or id).
 */
function getTestKvmImg(t, cb) {
    if (CONFIG.kvmImage) {
        assert.string(CONFIG.kvmPackage, 'CONFIG.kvmPackage');
        t.ok(CONFIG.kvmImage, 'kvmImage from config: ' + CONFIG.kvmImage);
        cb(null, CONFIG.kvmImage);
        return;
    }

    var candidateImageNames = {
        'ubuntu-certified-16.04': true
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

        t.ok(imgId,
            f('latest KVM image (using subset of supported names): %s (%s)',
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
        // Filter out those with 'kvm' in the name.
        pkgs = pkgs.filter(function (pkg) {
            return pkg.name.indexOf('kvm') == -1;
        });
        // Smallest RAM first.
        tabula.sortArrayOfObjects(pkgs, ['memory']);
        var pkgId = pkgs[0].id;
        t.ok(pkgId, f('smallest (RAM) available package: %s (%s)',
            pkgId, pkgs[0].name));
        cb(null, pkgId);
    });
}

/*
 * Find and return an package that can be used for *bhyve* test provisions.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, pkgId)`
 *      where `pkgId` is an package identifier (a name, shortid, or id).
 */
function getTestBhyvePkg(t, cb) {
    if (CONFIG.bhyvePackage) {
        assert.string(CONFIG.bhyvePackage, 'CONFIG.bhyvePackage');
        t.ok(CONFIG.bhyvePackage, 'bhyvePackage from config: ' +
            CONFIG.bhyvePackage);
        cb(null, CONFIG.bhyvePackage);
        return;
    }

    // bhyve uses the same packages as kvm
    safeTriton(t, ['pkg', 'ls', '-j'], function (err, stdout) {
        var pkgs = jsonStreamParse(stdout);
        // Filter on those with 'kvm' in the name.
        pkgs = pkgs.filter(function (pkg) {
            return pkg.name.indexOf('kvm') !== -1;
        });
        // Smallest RAM first.
        tabula.sortArrayOfObjects(pkgs, ['memory']);
        var pkgId = pkgs[0].id;
        t.ok(pkgId, f('smallest (RAM) available kvm package: %s (%s)',
            pkgId, pkgs[0].name));
        cb(null, pkgId);
    });
}

/*
 * Find and return an package that can be used for *KVM* test provisions.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, pkgId)`
 *      where `pkgId` is an package identifier (a name, shortid, or id).
 */
function getTestKvmPkg(t, cb) {
    if (CONFIG.kvmPackage) {
        assert.string(CONFIG.kvmPackage, 'CONFIG.kvmPackage');
        t.ok(CONFIG.kvmPackage, 'kvmPackage from config: ' + CONFIG.kvmPackage);
        cb(null, CONFIG.kvmPackage);
        return;
    }

    safeTriton(t, ['pkg', 'ls', '-j'], function (err, stdout) {
        var pkgs = jsonStreamParse(stdout);
        // Filter on those with 'kvm' in the name.
        pkgs = pkgs.filter(function (pkg) {
            return pkg.name.indexOf('kvm') !== -1;
        });
        // Smallest RAM first.
        tabula.sortArrayOfObjects(pkgs, ['memory']);
        var pkgId = pkgs[0].id;
        t.ok(pkgId, f('smallest (RAM) available KVM package: %s (%s)',
            pkgId, pkgs[0].name));
        cb(null, pkgId);
    });
}

/*
 * Find and return second smallest package name that can be used for
 * test provisions.
 *
 * @param {Tape} t - tape test object
 * @param {Function} cb - `function (err, {pkgs})`
 *      where `pkgs` is an Array of 2 test packages to use.
 */
function getResizeTestPkg(t, cb) {
    if (CONFIG.resizePackage) {
        t.ok(CONFIG.resizePackage, 'resizePackage from config: ' +
          CONFIG.resizePackage);
        cb(null, CONFIG.resizePackage);
        return;
    }

    safeTriton(t, ['pkg', 'ls', '-j'], function (err, stdout) {
        var pkgs = jsonStreamParse(stdout);
        // Smallest RAM first.
        tabula.sortArrayOfObjects(pkgs, ['memory']);
        var pkg = pkgs[1];
        t.ok(pkg.name, f('second smallest (RAM) available package: %s (%s)',
          pkg.id, pkg.name));
        cb(null, pkg.name);
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
 * Delete the given test instance (by name or id). It is not an error for the
 * instance to not exist. I.e. this is somewhat like `rm -f FILE`.
 *
 * Once we've validated that the inst exists, it *is* an error if the delete
 * fails. This function checks that with `t.ifErr`.
 *
 * @param {Tape} t - Tape test object on which to assert details.
 * @param {String} instNameOrId - The instance name or id to delete.
 * @param {Function} cb - `function ()`. A deletion error is NOT returned
 *      currently, because it is checked via `t.ifErr`.
 */
function deleteTestInst(t, instNameOrId, cb) {
    assert.object(t, 't');
    assert.string(instNameOrId, 'instNameOrId');
    assert.func(cb, 'cb');

    triton(['inst', 'get', '-j', instNameOrId],
            function onInstGet(err, stdout, _) {
        if (err) {
            if (err.code === 3) {  // `triton` code for ResourceNotFound
                t.ok(true, 'no existing inst ' + instNameOrId);
                cb();
            } else {
                t.ifErr(err, err);
                cb();
            }
        } else {
            var instToRm = JSON.parse(stdout);
            safeTriton(t, ['inst', 'rm', '-w', instToRm.id], function onRm() {
                t.ok(true, 'deleted inst ' + instToRm.id);
                cb();
            });
        }
    });
}

/*
 * Delete the given test image (by name or id). It is not an error for the
 * image to not exist. I.e. this is somewhat like `rm -f FILE`.
 *
 * Once we've validated that the image exists, it *is* an error if the delete
 * fails. This function checks that with `t.ifErr`.
 *
 * @param {Tape} t - Tape test object on which to assert details.
 * @param {String} imgNameOrId - The image name or id to delete.
 * @param {Function} cb - `function ()`. A deletion error is NOT returned
 *      currently, because it is checked via `t.ifErr`.
 */
function deleteTestImg(t, imgNameOrId, cb) {
    assert.object(t, 't');
    assert.string(imgNameOrId, 'imgNameOrId');
    assert.func(cb, 'cb');

    triton(['img', 'get', '-j', imgNameOrId],
            function onImgGet(err, stdout, _) {
        if (err) {
            if (err.code === 3) {  // `triton` code for ResourceNotFound
                t.ok(true, 'no existing img ' + imgNameOrId);
                cb();
            } else {
                t.ifErr(err, err);
                cb();
            }
        } else {
            var imgToRm = JSON.parse(stdout);
            safeTriton(t, ['img', 'rm', '-f', imgToRm.id], function onRm() {
                t.ok(true, 'deleted img ' + imgToRm.id);
                cb();
            });
        }
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

/*
 * Returns a string that represents a unique resource name for the host on which
 * this function is called.
 */
function makeResourceName(prefix) {
    assert.string(prefix, 'prefix');
    return prefix + '-' + os.hostname();
}

// --- exports

module.exports = {
    CONFIG: CONFIG,
    triton: triton,
    safeTriton: safeTriton,

    createClient: createClient,
    createTestInst: createTestInst,
    deleteTestInst: deleteTestInst,
    deleteTestImg: deleteTestImg,

    getTestImg: getTestImg,
    getTestBhyveImg: getTestBhyveImg,
    getTestKvmImg: getTestKvmImg,
    getTestPkg: getTestPkg,
    getTestBhyvePkg: getTestBhyvePkg,
    getTestKvmPkg: getTestKvmPkg,
    getResizeTestPkg: getResizeTestPkg,

    jsonStreamParse: jsonStreamParse,
    makeResourceName: makeResourceName,
    printConfig: printConfig,

    ifErr: testcommon.ifErr
};
