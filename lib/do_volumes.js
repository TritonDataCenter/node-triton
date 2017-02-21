/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 20167 Joyent, Inc.
 *
 * `triton volumes ...` bwcompat shortcut for `triton volumes list ...`.
 */

function do_volumes(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('volume').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_volumes.help = 'A shortcut for "triton volumes list".';
do_volumes.aliases = ['vols'];
do_volumes.hidden = true;
do_volumes.options = require('./do_volume/do_list').options;

module.exports = do_volumes;
