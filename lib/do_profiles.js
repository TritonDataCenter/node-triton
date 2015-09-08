/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton profile ...`
 */

var common = require('./common');
var errors = require('./errors');
var mod_config = require('./config');
var tabula = require('tabula');


var sortDefault = 'name';
var columnsDefault = 'name,curr,account,url';
var columnsDefaultLong = 'name,curr,account,url,insecure,keyId';

function do_profiles(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length > 1) {
        return cb(new errors.UsageError('too many args'));
    }

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
            configDir: this.triton.config._configDir,
            log: this.log
        });
    } catch (e) {
        return cb(e);
    }
    profiles.push(this.envProfile);

    // Display.
    var i;
    if (opts.json) {
        for (i = 0; i < profiles.length; i++) {
            profiles[i].curr = (profiles[i].name === this.triton.profile.name);
        }
        common.jsonStream(profiles);
    } else {
        for (i = 0; i < profiles.length; i++) {
            profiles[i].curr = (profiles[i].name === this.triton.profile.name
                ? '*' : '');
        }
        tabula(profiles, {
            skipHeader: opts.H,
            columns: columns,
            sort: sort
        });
    }
    cb();
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
    'List and update `triton` CLI profiles.',
    '',
    'A profile is a configured Triton CloudAPI endpoint. I.e. the',
    'url, account, key, etc. information required to call a CloudAPI.',
    'You can then switch between profiles with `triton -p PROFILE`',
    'or the TRITON_PROFILE environment variable.',
    '',
    'The "CURR" column indicates which profile is the current one.',
    '',
    'Usage:',
    '     {{name}} profiles',
    '',
    '{{options}}'
].join('\n');


module.exports = do_profiles;
