/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton ip ...` shortcut for `triton instance ip ...`.
 */

var targ = require('./do_instance/do_ip');

function do_ip(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'ip',
        opts: opts,
        args: args
    }, callback);
}

do_ip.help = 'A shortcut for "triton instance ip".';
do_ip.options = targ.options;
do_ip.completionArgtypes = targ.completionArgtypes;

module.exports = do_ip;
