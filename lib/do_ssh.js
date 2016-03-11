/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton ssh ...` bwcompat shortcut for `triton instance ssh ...`.
 */

var targ = require('./do_instance/do_ssh');

function do_ssh(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'ssh',
        opts: opts,
        args: args
    }, callback);
}

do_ssh.help = 'A shortcut for "triton instance ssh".';
do_ssh.interspersedOptions = targ.interspersedOptions;
do_ssh.options = targ.options;
do_ssh.completionArgtypes = targ.completionArgtypes;

module.exports = do_ssh;
