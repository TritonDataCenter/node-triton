/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton instances ...` bwcompat shortcut for `triton instance list ...`.
 */

function do_instances(subcmd, opts, args, callback) {
    var subcmdArgv = ['node', 'triton', 'instance', 'list'].concat(args);
    this.dispatch('instance', subcmdArgv, callback);
}

do_instances.help = [
    'A shortcut for "triton instance list".',
    '',
    'Usage:',
    '    {{name}} instances ...'
].join('\n');

do_instances.aliases = ['insts', 'ls'];

module.exports = do_instances;
