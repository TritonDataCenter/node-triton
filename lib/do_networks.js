/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton networks ...` bwcompat shortcut for `triton network list ...`.
 */

function do_networks(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'network', 'list'].concat(args);
    this.dispatch('network', subcmdArgv, callback);
}

do_networks.help = [
    'A shortcut for "triton network list".',
    '',
    'Usage:',
    '    {{name}} networks ...'
].join('\n');

do_networks.hidden = true;

module.exports = do_networks;
