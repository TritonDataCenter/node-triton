/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
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

function _listProfiles(_, opts, cb) {
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
            configDir: this.tritonapi.config._configDir,
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
            profiles[i].curr = (profiles[i].name ===
                this.tritonapi.profile.name);
        }
        common.jsonStream(profiles);
    } else {
        for (i = 0; i < profiles.length; i++) {
            profiles[i].curr = (profiles[i].name === this.tritonapi.profile.name
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

function _currentProfile(profile, opts, cb) {
    if (this.tritonapi.profile.name === profile.name) {
        console.log('"%s" is already the current profile', profile.name);
        return cb();
    }

    mod_config.setConfigVar({
        configDir: this.configDir,
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

// TODO: finish the implementation
//function _addProfile(profile, opts, cb) {
//}
//
//function _editProfile(profile, opts, cb) {
//}
//
//function _deleteProfile(profile, opts, cb) {
//}


function do_profiles(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    var actions = [];
    if (opts.add) { actions.push('add'); }
    if (opts.current) { actions.push('current'); }
    if (opts.edit) { actions.push('edit'); }
    if (opts['delete']) { actions.push('delete'); }
    var action;
    if (actions.length === 0) {
        action = 'list';
    } else if (actions.length > 1) {
        return cb(new errors.UsageError(
            'only one action option may be used at once'));
    } else {
        action = actions[0];
    }

    var name;
    switch (action) {
    case 'add':
        if (args.length === 1) {
            name = args[0];
        } else if (args.length > 1) {
            return cb(new errors.UsageError('too many args'));
        }
        break;
    case 'list':
    case 'current':
    case 'edit':
    case 'delete':
        name = opts.current || opts.edit || opts['delete'];
        if (args.length > 0) {
            return cb(new errors.UsageError('too many args'));
        }
        break;
    default:
        throw new Error('unknown action: ' + action);
    }

    var profile;
    if (name) {
        if (name === 'env') {
            profile = this.envProfile;
        } else {
            profile = mod_config.loadProfile({
                configDir: this.configDir,
                name: name
            });
        }
    }

    var func = {
        list: _listProfiles,
        current: _currentProfile
        // TODO: finish the implementation
        //add: _addProfile,
        //edit: _editProfile,
        //'delete': _deleteProfile
    }[action].bind(this);
    func(profile, opts, cb);
}

do_profiles.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: 'Action Options'
    },
    {
        names: ['current', 'c'],
        type: 'string',
        helpArg: 'NAME',
        help: 'Switch to the given profile.'
    }
    // TODO: finish the implementation
    //{
    //    names: ['add', 'a'],
    //    type: 'bool',
    //    help: 'Add a new profile.'
    //},
    //{
    //    names: ['edit', 'e'],
    //    type: 'string',
    //    helpArg: 'NAME',
    //    help: 'Edit profile NAME in your $EDITOR.'
    //},
    //{
    //    names: ['delete', 'd'],
    //    type: 'string',
    //    helpArg: 'NAME',
    //    help: 'Delete profile NAME.'
    //}

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
    '     {{name}} profiles                     # list profiles',
    '     {{name}} profiles -c|--current NAME   # set NAME as current profile',
    // TODO: finish the implementation
    //'     {{name}} profiles -a|--add [NAME]     # add a new profile',
    //'     {{name}} profiles -e|--edit NAME      # edit a profile in $EDITOR',
    //'     {{name}} profiles -d|--delete NAME    # delete a profile',
    '',
    '{{options}}'
].join('\n');

do_profiles.hidden = true;  // TODO: until -a,-e,-d are implemented


module.exports = do_profiles;
