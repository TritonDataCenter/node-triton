/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton vlan networks ...`
 */

var errors = require('../errors');


function do_networks(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing VLAN argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    opts.vlan_id = args[0];

    this.top.handlerFromSubcmd('network').dispatch({
        subcmd: 'list',
        opts: opts,
        args: []
    }, cb);
}

do_networks.synopses = ['{{name}} {{cmd}} [OPTIONS] VLAN'];

do_networks.help = [
    'Show all networks on a VLAN.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where VLAN is a VLAN id or name.'
].join('\n');

do_networks.options = require('../do_network/do_list').options;

module.exports = do_networks;
