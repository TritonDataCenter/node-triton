/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton images ...` bwcompat shortcut for `triton images list ...`.
 */

function do_images(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'image', 'list'].concat(args);
    this.dispatch('image', subcmdArgv, callback);
}

do_images.help = [
    'A shortcut for "triton image list".',
    '',
    'Usage:',
    '    {{name}} images ...'
].join('\n');

do_images.aliases = ['imgs'];

do_images.hidden = true;

module.exports = do_images;
