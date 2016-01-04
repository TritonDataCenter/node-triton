/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton delete ...` bwcompat shortcut for `triton instance delete ...`.
 */

function do_delete(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'instance', 'delete'].concat(args);
    this.dispatch('instance', subcmdArgv, callback);
}

do_delete.help = [
    'A shortcut for "triton instance delete".',
    '',
    'Usage:',
    '    {{name}} delete ...'
].join('\n');

do_delete.aliases = ['rm'];

module.exports = do_delete;
