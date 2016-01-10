/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton networks ...` bwcompat shortcut for `triton network list ...`.
 */

function do_networks(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('network').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_networks.help = 'A shortcut for "triton network list".';
do_networks.hidden = true;
do_networks.options = require('./do_network/do_list').options;

module.exports = do_networks;
