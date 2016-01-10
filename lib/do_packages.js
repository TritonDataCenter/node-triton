/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton packages ...` bwcompat shortcut for `triton package list ...`.
 */

function do_packages(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('package').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_packages.help = 'A shortcut for "triton package list".';
do_packages.aliases = ['pkgs'];
do_packages.hidden = true;
do_packages.options = require('./do_package/do_list').options;

module.exports = do_packages;
