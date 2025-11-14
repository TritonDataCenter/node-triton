/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys ...` shortcut for `triton accesskey list ...`.
 */

var targ = require('./do_accesskey/do_list');

function do_keys(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('accesskey').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_keys.help = 'A shortcut for "triton accesskey list".\n' + targ.help;
do_keys.synopses = targ.synopses;
do_keys.options = targ.options;
do_keys.completionArgtypes = targ.completionArgtypes;

do_keys.hidden = true;

module.exports = do_keys;
