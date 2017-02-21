/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance tags ...` shortcut for `triton instance tag list ...`.
 */

var targ = require('./do_tag/do_list');

function do_tags(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('tag').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_tags.help = 'A shortcut for "triton instance tag list".\n' + targ.help;
do_tags.synopses = targ.synopses;
do_tags.options = targ.options;
do_tags.completionArgtypes = targ.completionArgtypes;

do_tags.hidden = true;

module.exports = do_tags;
