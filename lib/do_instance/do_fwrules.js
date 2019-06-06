/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance fwrules ...` shortcut for
 * `triton instance fwrule list ...`.
 */

function do_fwrules(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('fwrule').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

var do_fwrule_list = require('./do_fwrule/do_list');
do_fwrules.help = do_fwrule_list.help;
do_fwrules.options = do_fwrule_list.options;
do_fwrules.synopses = do_fwrule_list.synopses;
do_fwrules.completionArgtypes = do_fwrule_list.completionArgtypes;

module.exports = do_fwrules;
