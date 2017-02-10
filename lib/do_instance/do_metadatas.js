/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance metadatas ...` shortcut for
 * `triton instance metadata list ...`.
 */

function do_metadatas(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('metadata').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_metadatas.help = 'A shortcut for "triton instance metadata list".';
do_metadatas.options = require('./do_metadata/do_list').options;
do_metadatas.hidden = true;

module.exports = do_metadatas;
