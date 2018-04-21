/*
 * Copyright 2016 Joyent Inc.
 *
 * `triton profile docker-setup ...`
 */

var assert = require('assert-plus');

var errors = require('../errors');
var profilecommon = require('./profilecommon');


function do_docker_setup(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    var profileName = args[0] || this.top.tritonapi.profile.name;
    profilecommon.profileDockerSetup({
        cli: this.top,
        name: profileName,
        implicit: false,
        yes: opts.yes,
        lifetime: opts.lifetime
    }, cb);
}

do_docker_setup.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['lifetime', 't'],
        type: 'number',
        help: 'Lifetime of the generated docker certificate, in days'
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer yes to any confirmations.'
    }
];

do_docker_setup.synopses = ['{{name}} {{cmd}} [PROFILE]'];
do_docker_setup.help = [
    /* BEGIN JSSTYLED */
    'Setup for using Docker with the current Triton CLI profile.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'A Triton datacenter can act as a virtual Docker Engine, where the entire',
    'datacenter is available on for running containers. The datacenter provides',
    'an endpoint against which you can run the regular `docker` client. This',
    'requires a one time setup to (a) generate a client TLS certificate to enable',
    'secure authentication with the Triton Docker Engine, and (b) to determine',
    'the DOCKER_HOST and related environment variables.',
    '',
    'After running this, you can setup your shell environment for `docker` via:',
    '    eval "$(triton env --docker)"',
    'or the equivalent. See `triton env --help` for details.'
    /* END JSSTYLED */
].join('\n');

do_docker_setup.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_docker_setup;
