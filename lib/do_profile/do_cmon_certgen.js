/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent Inc.
 *
 * `triton profile cmon-certgen ...`
 */

var assert = require('assert-plus');

var errors = require('../errors');
var profilecommon = require('./profilecommon');

function do_cmon_certgen(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    var profileName = args[0] || this.top.tritonapi.profile.name;
    profilecommon.profileCmonCertgen({
        cli: this.top,
        name: profileName,
        yes: opts.yes,
        lifetime: opts.lifetime
    }, cb);
}

do_cmon_certgen.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['lifetime', 't'],
        type: 'number',
        help: 'Lifetime of the generated cmon certificate, in days'
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer yes to any confirmations.'
    }
];

do_cmon_certgen.synopses = ['{{name}} {{cmd}} [PROFILE]'];
do_cmon_certgen.help = [
    /* BEGIN JSSTYLED */
    'Generate a CMON certificate with the current Triton CLI profile.',
    '',
    '{{usage}}',
    '{{options}}',
    'This only needs to be done once per cloud.'
    /* END JSSTYLED */
].join('\n');

do_cmon_certgen.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_cmon_certgen;
