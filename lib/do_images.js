/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton images ...` bwcompat shortcut for `triton image list ...`.
 */

var targ = require('./do_image/do_list');

function do_images(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('image').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_images.help = 'A shortcut for "triton image list".\n' + targ.help;
do_images.synopses = targ.synopses;
do_images.options = targ.options;
do_images.completionArgtypes = targ.completionArgtypes;

do_images.aliases = ['imgs'];
do_images.hidden = true;

module.exports = do_images;
