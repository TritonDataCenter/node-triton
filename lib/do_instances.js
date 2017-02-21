/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instances ...` bwcompat shortcut for `triton instance list ...`.
 */

var targ = require('./do_instance/do_list');

function do_instances(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_instances.help = 'A shortcut for "triton instance list".\n' + targ.help;
do_instances.synopses = targ.synopses;
do_instances.options = targ.options;
do_instances.completionArgtypes = targ.completionArgtypes;

do_instances.aliases = ['insts', 'ls'];

module.exports = do_instances;
