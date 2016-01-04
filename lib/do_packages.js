/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton packages ...` bwcompat shortcut for `triton package list ...`.
 */

function do_packages(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'package', 'list'].concat(args);
    this.dispatch('package', subcmdArgv, callback);
}

do_packages.help = [
    'A shortcut for "triton package list".',
    '',
    'Usage:',
    '    {{name}} packages ...'
].join('\n');

do_packages.aliases = ['pkgs'];

do_packages.hidden = true;

module.exports = do_packages;
