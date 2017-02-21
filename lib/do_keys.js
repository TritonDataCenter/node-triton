/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton keys ...` bwcompat shortcut for `triton key list ...`.
 */

var targ = require('./do_key/do_list');

function do_keys(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('key').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_keys.help = 'A shortcut for "triton key list".\n' + targ.help;
do_keys.synopses = targ.synopses;
do_keys.options = targ.options;
do_keys.completionArgtypes = targ.completionArgtypes;

do_keys.hidden = true;

module.exports = do_keys;
