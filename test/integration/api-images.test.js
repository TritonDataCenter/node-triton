/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

/*
 * Integration tests for using image-related APIs as a module.
 */

var h = require('./helpers');
var test = require('tape');

var common = require('../../lib/common');



// --- Globals



// --- Tests

test('TritonApi images', function (tt) {

    var client;
    tt.test(' setup: client', function (t) {
        h.createClient(function (err, client_) {
            t.error(err);
            client = client_;
            t.end();
        });
    });

    var testOpts = {};
    var img;
    tt.test(' TritonApi listImages', function (t) {
        client.listImages(function (err, images) {
            if (h.ifErr(t, err))
                return t.end();
            t.ok(images, 'images');
            t.ok(Array.isArray(images), 'images');
            if (images.length) {
                img = images[0];
                t.ok(img, 'img');
                t.ok(common.isUUID(img.id), 'img.id is a UUID');
                t.ok(img.name, 'img.name');
                t.ok(img.version, 'img.version');
            } else {
                testOpts.skip = true;
            }
            t.end();
        });
    });

    tt.test(' TritonApi getImage by uuid', testOpts, function (t) {
        client.getImage(img.id, function (err, image) {
            if (h.ifErr(t, err))
                return t.end();
            t.equal(image.id, img.id);
            t.end();
        });
    });

    tt.test(' TritonApi getImage by name', testOpts, function (t) {
        client.getImage(img.name, function (err, image) {
            if (h.ifErr(t, err))
                return t.end();
            t.equal(image.name, img.name); // might not be the same ID
            t.end();
        });
    });

    tt.test(' TritonApi getImage by name (opts)', testOpts, function (t) {
        client.getImage({name: img.name}, function (err, image) {
            if (h.ifErr(t, err))
                return t.end();
            t.equal(image.name, img.name); // might not be the same ID
            t.end();
        });
    });

    tt.test(' TritonApi getImage by shortId', testOpts, function (t) {
        var shortId = img.id.split('-')[0];
        client.getImage(shortId, function (err, image) {
            if (h.ifErr(t, err))
                return t.end();
            t.equal(image.id, img.id);
            t.end();
        });
    });

    tt.test(' teardown: client', function (t) {
        client.close();
        t.end();
    });
});
