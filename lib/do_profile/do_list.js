/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profiles ...`
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
    for (i = 0; i < profiles.length; i++) {
        var profile = profiles[i];
        if (profile.name === cli.tritonapi.profile.name) {
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
do_list.help = [
    /* BEGIN JSSTYLED */
    'List Triton CLI profiles.',
    '',
    'A profile is a configured Triton CloudAPI endpoint and associated info.',
    'I.e. the URL, account name, SSH key fingerprint, etc. information required',
    'to call a CloudAPI endpoint in a Triton datacenter. You can then switch',
    'between profiles with `triton -p PROFILE`, the TRITON_PROFILE environment',
    'variable, or by setting your current profile.',
    '',
    'The "CURR" column indicates which profile is the current one.',
    '',
    'Usage:',
    '    {{name}} list',
    '',
    '{{options}}'
    /* END JSSTYLED */
].join('\n');


do_list.aliases = ['ls'];

module.exports = do_list;
