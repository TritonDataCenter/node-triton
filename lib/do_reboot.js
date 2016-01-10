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

function do_reboot(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'reboot',
        opts: opts,
        args: args
    }, callback);
}

do_reboot.help = 'A shortcut for "triton instance reboot".';
do_reboot.options = require('./do_instance/do_reboot').options;

module.exports = do_reboot;
