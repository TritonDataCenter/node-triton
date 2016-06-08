/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profile set-current ...`
 */

var errors = require('../errors');
var profilecommon = require('./profilecommon');



function do_set_current(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length === 0) {
        cb(new errors.UsageError('missing NAME argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('too many arguments: ' + args.join(' ')));
        return;
    }

    profilecommon.setCurrentProfile({cli: this.top, name: args[0]}, cb);
}

do_set_current.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_set_current.synopses = ['{{name}} {{cmd}} PROFILE'];
do_set_current.help = [
    'Set the current Triton CLI profile.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'NAME is the name of an existing profile, or "-" to switch to the',
    'previously set profile.',
    '',
    'The "current" profile is the one used by default, unless overridden by',
    '`triton -p PROFILE-NAME ...` or the TRITON_PROFILE environment variable.'
].join('\n');

do_set_current.aliases = ['set'];

do_set_current.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_set_current;
