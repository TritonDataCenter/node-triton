/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton profiles ...` bwcompat shortcut for `triton profile list ...`.
 */

function do_profiles(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('profile').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_profiles.help = 'A shortcut for "triton profile list".';
do_profiles.options = require('./do_profile/do_list').options;
do_profiles.hidden = true;

module.exports = do_profiles;
