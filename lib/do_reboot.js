/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton reboot ...` bwcompat shortcut for `triton instance reboot ...`.
 */

function do_reboot(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'instance', 'reboot'].concat(args);
    this.dispatch('instance', subcmdArgv, callback);
}

do_reboot.help = [
    'A shortcut for "triton instance reboot".',
    '',
    'Usage:',
    '    {{name}} reboot ...'
].join('\n');

module.exports = do_reboot;
