/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton create ...` bwcompat shortcut for `triton instance create ...`.
 */

function do_create(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('instance').dispatch({
        subcmd: 'create',
        opts: opts,
        args: args
    }, callback);
}

do_create.help = 'A shortcut for "triton instance create".';
do_create.options = require('./do_instance/do_create').options;

module.exports = do_create;
