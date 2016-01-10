/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instances ...` bwcompat shortcut for `triton instance list ...`.
 */

function do_instances(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_instances.help = 'A shortcut for "triton instance list".';
do_instances.aliases = ['insts', 'ls'];
do_instances.options = require('./do_instance/do_list').options;

module.exports = do_instances;
