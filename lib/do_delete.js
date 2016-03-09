/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton delete ...` bwcompat shortcut for `triton instance delete ...`.
 */

var targ = require('./do_instance/do_delete');

function do_delete(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'delete',
        opts: opts,
        args: args
    }, callback);
}

do_delete.help = 'A shortcut for "triton instance delete".';
do_delete.aliases = ['rm'];
do_delete.options = targ.options;
do_delete.completionArgtypes = targ.completionArgtypes;

module.exports = do_delete;
