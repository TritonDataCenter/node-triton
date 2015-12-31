/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton profiles ...` bwcompat shortcut for `triton profile list ...`.
 */

function do_profiles(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'profile', 'list'].concat(args);
    this.dispatch('profile', subcmdArgv, callback);
}

do_profiles.help = [
    'A shortcut for "triton profile list".',
    '',
    'Usage:',
    '    {{name}} profiles ...'
].join('\n');

do_profiles.hidden = true;

module.exports = do_profiles;
