/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton keys ...` bwcompat shortcut for `triton keys list ...`.
 */

function do_keys(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'key', 'list'].concat(args);
    this.dispatch('key', subcmdArgv, callback);
}

do_keys.help = [
    'A shortcut for "triton key list".',
    '',
    'Usage:',
    '    {{name}} key ...'
].join('\n');

do_keys.hidden = true;

module.exports = do_keys;
