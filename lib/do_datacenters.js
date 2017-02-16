/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton datacenters ...`
 */

function do_datacenters(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('datacenter').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_datacenters.help = 'A shortcut for "triton datacenter list".';
do_datacenters.hidden = true;
do_datacenters.options = require('./do_datacenter/do_list').options;

module.exports = do_datacenters;
