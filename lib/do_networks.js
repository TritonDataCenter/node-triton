/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton networks ...` bwcompat shortcut for `triton network list ...`.
 */

var targ = require('./do_network/do_list');

function do_networks(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('network').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_networks.help = 'A shortcut for "triton network list".\n' + targ.help;
do_networks.synopses = targ.synopses;
do_networks.options = targ.options;
do_networks.completionArgtypes = targ.completionArgtypes;

do_networks.hidden = true;

module.exports = do_networks;
