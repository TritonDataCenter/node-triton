/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton packages ...` bwcompat shortcut for `triton package list ...`.
 */

var targ = require('./do_package/do_list');

function do_packages(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('package').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_packages.help = 'A shortcut for "triton package list".\n' + targ.help;
do_packages.synopses = targ.synopses;
do_packages.options = targ.options;
do_packages.completionArgtypes = targ.completionArgtypes;

do_packages.aliases = ['pkgs'];
do_packages.hidden = true;

module.exports = do_packages;
