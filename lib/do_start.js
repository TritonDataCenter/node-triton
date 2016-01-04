/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton start ...` bwcompat shortcut for `triton instance start ...`.
 */

function do_start(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'instance', 'start'].concat(args);
    this.dispatch('instance', subcmdArgv, callback);
}

do_start.help = [
    'A shortcut for "triton instance start".',
    '',
    'Usage:',
    '    {{name}} start ...'
].join('\n');

module.exports = do_start;
