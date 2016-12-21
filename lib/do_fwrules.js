/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * `triton fwrules ...` shortcut for `triton fwrule list ...`.
 */

function do_fwrules(subcmd, opts, args, callback) {
    this.handlerFromSubcmd('fwrule').dispatch({
        subcmd: 'list',
        opts: opts,
        args: args
    }, callback);
}

do_fwrules.help = 'A shortcut for "triton fwrule list".';
do_fwrules.hidden = true;
do_fwrules.options = require('./do_fwrule/do_list').options;

module.exports = do_fwrules;
