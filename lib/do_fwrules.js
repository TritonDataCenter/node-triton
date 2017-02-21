/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton fwrules ...` shortcut for `triton fwrule list ...`.
 */

var targ = require('./do_fwrule/do_list');

function do_fwrules(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('fwrule').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_fwrules.help = 'A shortcut for "triton fwrule list".\n' + targ.help;
do_fwrules.synopses = targ.synopses;
do_fwrules.options = targ.options;
do_fwrules.completionArgtypes = targ.completionArgtypes;

do_fwrules.hidden = true;

module.exports = do_fwrules;
