/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton package ...`
 */

var fs = require('fs');
var once = require('once');
var path = require('path');


function do_badger(subcmd, opts, args, callback) {
    var callbackOnce = once(callback);
    var badger = path.resolve(__dirname, '../etc/badger');
    var input = fs.createReadStream(badger);
    input.pipe(process.stdout);
    input.on('error', function (err) {
        callbackOnce(err);
    });
    input.on('end', function () {
        callbackOnce();
    });
}

do_badger.options = [];
do_badger.help = 'Badger don\'t care.';
do_badger.hidden = true;

module.exports = do_badger;
