/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disks ...` shortcut for
 * `triton instance disk list ...`.
 */

var targ = require('./do_disk/do_list');

function do_disks(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('disk').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_disks.help = 'A shortcut for "triton instance disk list".\n' +
    targ.help;
do_disks.synopses = targ.synopses;
do_disks.options = targ.options;
do_disks.completionArgtypes = targ.completionArgtypes;

do_disks.hidden = true;

module.exports = do_disks;
