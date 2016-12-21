/*
 * Copyright 2016 Joyent Inc.
 *
 * `triton profile list ...`
 */

var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');
var mod_config = require('../config');


var sortDefault = 'name';
var columnsDefault = 'name,curr,account,user,url';
var columnsDefaultLong = 'name,curr,account,user,url,insecure,keyId';

function _listProfiles(cli, opts, args, cb) {
    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = columnsDefaultLong;
    }
    columns = columns.split(',');

    var sort = opts.s.split(',');

    // Load all the profiles. "env" is a special one managed by the CLI.
    var profiles;
    try {
        profiles = mod_config.loadAllProfiles({
            configDir: cli.configDir,
            log: cli.log
        });
    } catch (e) {
        return cb(e);
    }

    // Current profile: Set 'curr' field. Apply CLI overrides.
    var currProfile;
    try {
        currProfile = cli.tritonapi.profile;
    } catch (err) {
        // Ignore inability to load a profile.
        if (!(err instanceof errors.ConfigError)) {
            throw err;
        }
    }
    var haveCurr = false;
    for (i = 0; i < profiles.length; i++) {
        var profile = profiles[i];
        if (currProfile && profile.name === currProfile.name) {
            haveCurr = true;
            cli._applyProfileOverrides(profile);
            if (opts.json) {
                profile.curr = true;
            } else {
                profile.curr = '*'; // tabular
            }
        } else {
            if (opts.json) {
                profile.curr = false;
            } else {
                profile.curr = ''; // tabular
            }
        }
    }

    // Display.
    var i;
    if (opts.json) {
        common.jsonStream(profiles);
    } else {
        tabula(profiles, {
            skipHeader: opts.H,
            columns: columns,
            sort: sort
        });
        if (!haveCurr) {
            if (profiles.length === 0) {
                process.stderr.write('\nWarning: There is no current profile. '
                    + 'Use "triton profile create" to create one,\n'
                    + 'or set the required "SDC_*/TRITON_*" environment '
                    + 'variables: see "triton --help".\n');
            } else {
                process.stderr.write('\nWarning: There is no current profile. '
                    + 'Use "triton profile set-current ..."\n'
                    + 'to set one or "triton profile create" to create one.\n');
            }
        }
    }
    cb();
}


function do_list(subcmd, opts, args, cb) {
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length > 0) {
        return cb(new errors.UsageError('too many args'));
    }

    _listProfiles(this.top, opts, args, cb);
}

do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));
do_list.synopses = ['{{name}} {{cmd}} [OPTIONS]'];
do_list.help = [
    /* BEGIN JSSTYLED */
    'List Triton CLI profiles.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'A profile is a configured Triton CloudAPI endpoint and associated info.',
    'I.e. the URL, account name, SSH key fingerprint, etc. information required',
    'to call a CloudAPI endpoint in a Triton datacenter. You can then switch',
    'between profiles with `triton -p PROFILE`, the TRITON_PROFILE environment',
    'variable, or by setting your current profile.',
    '',
    'The "CURR" column indicates which profile is the current one.'
    /* END JSSTYLED */
].join('\n');


do_list.aliases = ['ls'];

module.exports = do_list;
