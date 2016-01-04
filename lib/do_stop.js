/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton stop ...` bwcompat shortcut for `triton instance stop ...`.
 */

function do_stop(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'instance', 'stop'].concat(args);
    this.dispatch('instance', subcmdArgv, callback);
}

do_stop.help = [
    'A shortcut for "triton instance stop".',
    '',
    'Usage:',
    '    {{name}} stop ...'
].join('\n');

module.exports = do_stop;
