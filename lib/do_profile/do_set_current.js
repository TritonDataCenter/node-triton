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
    } else if (args.length !== 1) {
        return cb(new errors.UsageError('NAME argument is required'));
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

do_set_current.help = [
    'Set the current Triton CLI profile.',
    '',
    'Usage:',
    '    {{name}} set-current NAME',
    '',
    '{{options}}',
    'The "current" profile is the one used by default, unless overridden by',
    '`triton -p PROFILE-NAME ...` or the TRITON_PROFILE environment variable.'
].join('\n');

do_set_current.aliases = ['set'];

do_set_current.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_set_current;
