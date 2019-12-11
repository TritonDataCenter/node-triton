/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Test image commands.
 */

var format = require('util').format;
var os = require('os');
var test = require('tap').test;
var vasync = require('vasync');

var common = require('../../lib/common');
var h = require('./helpers');


// --- globals

var _RESOURCE_NAME_PREFIX = 'nodetritontest-image-create-kvm-' + os.hostname();
var ORIGIN_INST_ALIAS = _RESOURCE_NAME_PREFIX + '-origin';
var IMAGE_DATA = {
    name: _RESOURCE_NAME_PREFIX + '-image',
    version: '1.0.0'
};
var DERIVED_INST_ALIAS = _RESOURCE_NAME_PREFIX + '-derived';
delete _RESOURCE_NAME_PREFIX;

var testOpts = {
    skip: (!h.CONFIG.allowWriteActions || h.CONFIG.skipKvmTests) &&
        'requires config.allowWriteActions and config.skipKvmTests=false'
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
    suite.test('  setup: rm existing origin inst ' + ORIGIN_INST_ALIAS,
            function (t) {
        h.deleteTestInst(t, ORIGIN_INST_ALIAS, function onDel() {
            t.end();
        });
    });

    // TODO: `triton rm -f` would be helpful for this
    suite.test('  setup: rm existing derived inst ' + DERIVED_INST_ALIAS,
            function (t) {
        h.deleteTestInst(t, DERIVED_INST_ALIAS, function onDel() {
            t.end();
        });
    });

    suite.test('  setup: rm existing img ' + imgNameVer, function (t) {
        h.deleteTestImg(t, imgNameVer, function onDel() {
            t.end();
        });
    });

    var originImgNameOrId;
    suite.test('  setup: find origin image', function (t) {
        h.getTestKvmImg(t, function (err, imgId) {
            t.ifError(err, 'getTestImg' + (err ? ': ' + err : ''));
            originImgNameOrId = imgId;
            t.end();
        });
    });

    var pkgId;
    suite.test('  setup: find test package', function (t) {
        h.getTestKvmPkg(t, function (err, pkgId_) {
            t.ifError(err, 'getTestPkg' + (err ? ': ' + err : ''));
            pkgId = pkgId_;
            t.end();
        });
    });

    var markerFile = '/nodetritontest-was-here.txt';
    suite.test('  setup: triton create ... -n ' + ORIGIN_INST_ALIAS,
    function (t) {
        var argv = ['create', '-wj', '-n', ORIGIN_INST_ALIAS,
            '-m', 'user-script=touch ' + markerFile,
            originImgNameOrId, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
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
    //suite.test('  setup: add marker to origin', function (t) {
    //    var argv = ['ssh', originInst.id,
    //        '-o', 'StrictHostKeyChecking=no',
    //        '-o', 'UserKnownHostsFile=/dev/null',
    //        'touch', markerFile];
    //    h.safeTriton(t, argv, function (err, stdout) {
    //        t.ifError(err, 'adding origin marker file, err=' + err);
    //        t.end();
    //    });
    //});

    suite.test('  triton image create ...', function (t) {
        var argv = ['image', 'create', '-j', '-w', '-t', 'foo=bar',
            originInst.id, IMAGE_DATA.name, IMAGE_DATA.version];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            img = lines[1];
            t.ok(img, 'created image, id=' + img.id);
            t.equal(img.name, IMAGE_DATA.name, 'img.name');
            t.equal(img.version, IMAGE_DATA.version, 'img.version');
            t.equal(img.public, false, 'img.public is false');
            t.equal(img.state, 'active', 'img.state is active');
            t.equal(img.origin, originInst.image, 'img.origin');
            t.end();
        });
    });

    var derivedInst;
    suite.test('  triton create ... -n ' + DERIVED_INST_ALIAS, function (t) {
        var argv = ['create', '-wj', '-n', DERIVED_INST_ALIAS, img.id, pkgId];
        h.safeTriton(t, argv, function (err, stdout) {
            var lines = h.jsonStreamParse(stdout);
            derivedInst = lines[1];
            t.ok(derivedInst.id, 'derivedInst.id: ' + derivedInst.id);
            t.equal(lines[1].state, 'running', 'derivedInst is running');
            t.end();
        });
    });

    // TODO: Once have `triton ssh ...` working in test suite without hangs,
    //      then want to check that the created VM has the markerFile.

    // Remove instances. Add a test timeout, because '-w' on delete doesn't
    // have a way to know if the attempt failed or if it is just taking a
    // really long time.
    suite.test('  cleanup: triton rm', {timeout: 10 * 60 * 1000}, function (t) {
        h.safeTriton(t, ['rm', '-f', '-w', originInst.id, derivedInst.id],
                function () {
            t.end();
        });
    });

    suite.test('  cleanup: triton image rm', function (t) {
        h.safeTriton(t, ['image', 'rm', '-f', img.id], function () {
            t.end();
        });
    });

    suite.end();
});
