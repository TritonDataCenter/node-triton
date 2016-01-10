/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton start ...` bwcompat shortcut for `triton instance start ...`.
 */

function do_start(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'start',
        opts: opts,
        args: args
    }, callback);
}

do_start.help = 'A shortcut for "triton instance start".';
do_start.options = require('./do_instance/do_start').options;

module.exports = do_start;
