/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton keys ...` bwcompat shortcut for `triton key list ...`.
 */

function do_keys(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('key').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_keys.help = 'A shortcut for "triton key list".';
do_keys.hidden = true;
do_keys.options = require('./do_key/do_list').options;

module.exports = do_keys;
