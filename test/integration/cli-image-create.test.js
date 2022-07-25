/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 */

/*
 * Test image commands.
 */

var format = require('util').format;
var os = require('os');
var test = require('tap').test;
var uuid = require('uuid');

var h = require('./helpers');


// --- globals

var ORIGIN_ALIAS = format('nodetritontest-images-%s-origin', os.hostname());
var IMAGE_DATA = {
    name: format('nodetritontest-images-%s', os.hostname()),
    version: '1.0.0'
};
var DERIVED_ALIAS = format('nodetritontest-images-%s-derived', os.hostname());

var testOpts = {
    skip: (
        !h.CONFIG.allowImageCreate || !h.CONFIG.allowWriteActions
    ) && 'requires config.allowWriteActions and config.allowImageCreate'
};


// --- Tests

test('triton image ...', testOpts, function (suite) {
    var imgNameVer = IMAGE_DATA.name + '@' + IMAGE_DATA.version;
    var originInst;
    var img;

    suite.comment('Test config:');
    Object.keys(h.CONFIG).forEach(function (key) {
        var value = h.CONFIG[key];
        suite.comment(format('- %s: %j', key, value));
    });

    // TODO: `triton rm -f` would be helpful for this
    suite.test('  setup: rm existing origin inst ' + ORIGIN_ALIAS,
    function (t) {
        h.triton(['inst', 'get', '-j', ORIGIN_ALIAS],
                function (err, stdout, stderr) {
            if (err) {
                if (err.code === 3) { // `triton` code for ResourceNotFound
                    t.ok(true, 'no pre-existing inst ' + ORIGIN_ALIAS);
                    t.end();
                } else {
                    t.ifErr(err, err);
                    t.end();
                }
            } else {
                var instToRm = JSON.parse(stdout);
                h.safeTriton(t, ['inst', 'rm', '-f', '-w', instToRm.id],
                    function () {
                    t.ok(true, 'deleted inst ' + instToRm.id);
                    t.end();
                });
            }
        });
    });

    // TODO: `triton rm -f` would be helpful for this
    suite.test('  setup: rm existing derived inst ' + DERIVED_ALIAS,
    function (t) {
        h.triton(['inst', 'get', '-j', DERIVED_ALIAS],
                function (err, stdout, stderr) {
            if (err) {
                if (err.code === 3) { // `triton` code for ResourceNotFound
                    t.ok(true, 'no pre-existing inst ' + DERIVED_ALIAS);
                    t.end();
                } else {
                    t.ifErr(err, err);
                    t.end();
                }
            } else {
                var instToRm = JSON.parse(stdout);
                h.safeTriton(t, ['inst', 'rm', '-f', '-w', instToRm.id],
                    function () {
                    t.ok(true, 'deleted inst ' + instToRm.id);
                    t.end();
                });
            }
        });
    });

    suite.test('  setup: rm existing img ' + imgNameVer, function (t) {
        h.triton(['img', 'get', '-j', imgNameVer],
                function (err, stdout, stderr) {
            if (err) {
                if (err.code === 3) { // `triton` code for ResourceNotFound
                    t.ok(true, 'no pre-existing img ' + imgNameVer);
                    t.end();
                } else {
                    t.ifErr(err, err);
                    t.end();
                }
            } else {
                var imgToRm = JSON.parse(stdout);
                h.safeTriton(t, ['image', 'rm', '-f', imgToRm.id], function () {
                    t.ok(true, 'deleted img ' + imgToRm.id);
                    t.end();
                });
            }
        });
    });

    var originImgNameOrId;
    suite.test('  setup: find origin image', function (t) {
        h.getTestImg(t, function (err, imgId) {
            t.ifError(err, 'getTestImg' + (err ? ': ' + err : ''));
            originImgNameOrId = imgId;
            t.end();
        });
    });

    var pkgId;
    suite.test('  setup: find test package', function (t) {
        h.getTestPkg(t, function (err, pkgId_) {
            t.ifError(err, 'getTestPkg' + (err ? ': ' + err : ''));
            pkgId = pkgId_;
            t.end();
        });
    });

    var markerFile = '/nodetritontest-was-here.txt';
    suite.test('  setup: triton create ... -n ' + ORIGIN_ALIAS, function (t) {
        var argv = ['create', '-wj', '-n', ORIGIN_ALIAS,
            '-m', 'user-script=touch ' + markerFile,
            originImgNameOrId, pkgId];
        h.safeTriton(t, argv, function (_err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            originInst = lines[1];
            t.ok(originInst.id, 'originInst.id: ' + originInst.id);
            t.equal(lines[1].state, 'running', 'originInst is running');
            t.end();
        });
    });

    // TODO: I'd like to use this 'triton ssh INST touch $markerFile' to
    //      tweak the image. However, that current hangs when run via
    //      tape (don't know why yet). Instead we'll use a user-script to
    //      change the origin as our image change.
    //
    // suite.test('  setup: add marker to origin', function (t) {
    //    var argv = ['ssh', originInst.id,
    //        '-o', 'StrictHostKeyChecking=no',
    //        '-o', 'UserKnownHostsFile=/dev/null',
    //        'touch', markerFile];
    //    h.safeTriton(t, argv, function (err, stdout) {
    //        t.ifError(err, 'adding origin marker file, err=' + err);
    //        t.end();
    //    });
    // });

    suite.test('  triton image create ...', function (t) {
        var argv = ['image', 'create', '-j', '-w', '-t', 'foo=bar',
            originInst.id, IMAGE_DATA.name, IMAGE_DATA.version];
        h.safeTriton(t, argv, function (err, stdout) {
            if (!err) {
                var lines = h.jsonStreamParse(stdout);
                img = lines[1];
                t.ok(img, 'created image, id=' + img.id);
                t.equal(img.name, IMAGE_DATA.name, 'img.name');
                t.equal(img.version, IMAGE_DATA.version, 'img.version');
                t.equal(img.public, false, 'img.public is false');
                t.equal(img.state, 'active', 'img.state is active');
                t.equal(img.origin, originInst.image, 'img.origin');
            }
            t.end();
        });
    });

    var derivedInst;
    suite.test('  triton create ... -n ' + DERIVED_ALIAS, function (t) {
        t.ok(img, 'have an img to test');
        if (img) {
            var argv = ['create', '-wj', '-n', DERIVED_ALIAS, img.id, pkgId];
            h.safeTriton(t, argv, function (err, stdout) {
                if (!err) {
                    var lines = h.jsonStreamParse(stdout);
                    derivedInst = lines[1];
                    t.ok(derivedInst.id, 'derivedInst.id: ' + derivedInst.id);
                    t.equal(lines[1].state, 'running',
                        'derivedInst is running');
                }
                t.end();
            });
        } else {
            t.end();
        }
    });

    suite.test('  triton image share ...', function (t) {
        var dummyUuid = uuid.v4();
        var argv = ['image', 'share', img.id, dummyUuid];
        h.safeTriton(t, argv, function (err) {
            if (err) {
                t.end();
                return;
            }
            argv = ['image', 'get', '-j', img.id];
            h.safeTriton(t, argv, function (err2, stdout2) {
                t.ifErr(err2, 'image get response');
                if (err2) {
                    t.end();
                    return;
                }
                var result = JSON.parse(stdout2);
                t.ok(result, 'image share result');
                t.ok(result.acl, 'image share result.acl');
                if (result.acl && Array.isArray(result.acl)) {
                    t.notEqual(result.acl.indexOf(dummyUuid), -1,
                        'image share result.acl contains uuid');
                } else {
                    t.fail('image share result does not contain acl array');
                }
                unshareImage();
            });
        });

        function unshareImage() {
            argv = ['image', 'unshare', img.id, dummyUuid];
            h.safeTriton(t, argv, function (err) {
                if (err) {
                    t.end();
                    return;
                }
                argv = ['image', 'get', '-j', img.id];
                h.safeTriton(t, argv, function (err2, stdout2) {
                    t.ifErr(err2, 'image get response');
                    if (err2) {
                        t.end();
                        return;
                    }
                    var result = JSON.parse(stdout2);
                    t.ok(result, 'image unshare result');
                    if (result.acl && Array.isArray(result.acl)) {
                        t.equal(result.acl.indexOf(dummyUuid), -1,
                            'image unshare result.acl should not contain uuid');
                    } else {
                        t.equal(result.acl, undefined, 'image has no acl');
                    }
                    t.end();
                });
            });
        }
    });

    suite.test('   triton image update ...', function (t) {
        var argv = ['image', 'update', img.id,
            'description=this is a description'];
        h.safeTriton(t, argv, function (err) {
            if (err) {
                t.end();
                return;
            }
            argv = ['image', 'get', '-j', img.id];
            h.safeTriton(t, argv, function (err2, stdout2) {
                t.ifErr(err2, 'image get response');
                if (err2) {
                    t.end();
                    return;
                }
                var result = JSON.parse(stdout2);
                t.ok(result, 'image update result');
                t.comment(result.description);
                t.ok(result.description, 'image update result.description');
                if (result.description) {
                    t.equal(result.description, 'this is a description',
                        'image update description');
                } else {
                    t.fail('image update result does not contain description');
                }
                t.end();
            });
        });
    });

    suite.test('   triton image tag', function (t) {
        var argv = ['image', 'tag', img.id,
            'foo="bar"', 'bool=true', 'one=1'];
        h.safeTriton(t, argv, function (err) {
            if (err) {
                t.end();
                return;
            }
            argv = ['image', 'get', '-j', img.id];
            h.safeTriton(t, argv, function (err2, stdout2) {
                t.ifErr(err2, 'image get response');
                if (err2) {
                    t.end();
                    return;
                }
                var result = JSON.parse(stdout2);
                t.ok(result, 'image tag result');
                t.ok(result.tags, 'image tag result.tags');
                if (result.tags) {
                    t.ok(result.tags.foo, 'result.tags.foo');
                    t.ok(result.tags.one, 'result.tags.one');
                    t.ok(result.tags.bool, 'result.tags.bool');
                } else {
                    t.fail('image tag result does not contain tags');
                }
                t.end();
            });
        });
    });

    // TODO: Once have `triton ssh ...` working in test suite without hangs,
    //      then want to check that the created VM has the markerFile.

    // Remove instances. Add a test timeout, because '-w' on delete doesn't
    // have a way to know if the attempt failed or if it is just taking a
    // really long time.
    suite.test('  cleanup: triton rm', {timeout: 10 * 60 * 1000}, function (t) {
        if (!originInst || !derivedInst) {
            t.end();
            return;
        }
        h.safeTriton(t, ['rm', '-f', '-w', originInst.id, derivedInst.id],
                function () {
            t.end();
        });
    });

    suite.test('  cleanup: triton image rm', function (t) {
        if (!img) {
            t.end();
            return;
        }
        h.safeTriton(t, ['image', 'rm', '-f', img.id], function () {
            t.end();
        });
    });

    suite.end();
});
