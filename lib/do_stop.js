/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton stop ...` bwcompat shortcut for `triton instance stop ...`.
 */

function do_stop(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'stop',
        opts: opts,
        args: args
    }, callback);
}

do_stop.help = 'A shortcut for "triton instance stop".';
do_stop.options = require('./do_instance/do_stop').options;

module.exports = do_stop;
