/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profiles ...`
 */

var common = require('./common');
var errors = require('./errors');
var mod_config = require('./config');
var tabula = require('tabula');


var sortDefault = 'name';
var columnsDefault = 'name,curr,account,url';
var columnsDefaultLong = 'name,curr,account,url,insecure,keyId';

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
            configDir: cli.tritonapi.config._configDir,
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

function _currentProfile(cli, opts, args, cb) {
    var profile = mod_config.loadProfile({
        configDir: cli.configDir,
        name: opts.current
    });

    if (cli.tritonapi.profile.name === profile.name) {
        console.log('"%s" is already the current profile', profile.name);
        return cb();
    }

    mod_config.setConfigVar({
        configDir: cli.configDir,
        name: 'profile',
        value: profile.name
    }, function (err) {
        if (err) {
            return cb(err);
        }
        console.log('Switched to "%s" profile', profile.name);
        cb();
    });
}

function do_profiles(subcmd, opts, args, cb) {
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length > 0) {
        return cb(new errors.UsageError('too many args'));
    }

    if (opts.current) {
        _currentProfile(this, opts, args, cb);
    } else {
        _listProfiles(this, opts, args, cb);
    }
}

do_profiles.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));
do_profiles.help = [
    'List `triton` CLI profiles.',
    '',
    'A profile is a configured Triton CloudAPI endpoint. I.e. the',
    'url, account, key, etc. information required to call a CloudAPI.',
    'You can then switch between profiles with `triton -p PROFILE`',
    'or the TRITON_PROFILE environment variable.',
    '',
    'The "CURR" column indicates which profile is the current one.',
    '',
    'Usage:',
    '    {{name}} profiles',
    '',
    '{{options}}'
].join('\n');



module.exports = do_profiles;
