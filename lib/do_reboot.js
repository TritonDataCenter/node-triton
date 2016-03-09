/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton reboot ...` bwcompat shortcut for `triton instance reboot ...`.
 */

var targ = require('./do_instance/do_reboot');

function do_reboot(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'reboot',
        opts: opts,
        args: args
    }, callback);
}

do_reboot.help = 'A shortcut for "triton instance reboot".';
do_reboot.options = targ.options;
do_reboot.completionArgtypes = targ.completionArgtypes;

module.exports = do_reboot;
