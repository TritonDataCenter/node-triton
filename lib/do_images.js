/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton images ...` bwcompat shortcut for `triton image list ...`.
 */

function do_images(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('image').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_images.help = 'A shortcut for "triton image list".';
do_images.aliases = ['imgs'];
do_images.hidden = true;
do_images.options = require('./do_image/do_list').options;

module.exports = do_images;
