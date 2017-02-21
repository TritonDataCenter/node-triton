/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance snapshots ...` shortcut for
 * `triton instance snapshot list ...`.
 */

var targ = require('./do_snapshot/do_list');

function do_snapshots(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('snapshot').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_snapshots.help = 'A shortcut for "triton instance snapshot list".\n' +
    targ.help;
do_snapshots.synopses = targ.synopses;
do_snapshots.options = targ.options;
do_snapshots.completionArgtypes = targ.completionArgtypes;

do_snapshots.hidden = true;

module.exports = do_snapshots;
