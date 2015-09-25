/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profile ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var strsplit = require('strsplit');
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');
var mod_config = require('./config');



function _showProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        return cb(err);
    }

    if (profile.name === cli.tritonapi.profile.name) {
        cli._applyProfileOverrides(profile);
        profile.curr = true;
    } else {
        profile.curr = false;
    }

    if (opts.json) {
        console.log(JSON.stringify(profile));
    } else {
        Object.keys(profile).sort().forEach(function (key) {
            var val = profile[key];
            console.log('%s: %s', key, val);
        });
    }
}

function _currentProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        return cb(err);
    }

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
        console.log('Set "%s" as current profile', profile.name);
        cb();
    });
}


function _yamlishFromProfile(profile) {
    assert.object(profile, 'profile');

    var keys = [];
    var skipKeys = ['curr', 'name'];
    Object.keys(profile).forEach(function (key) {
        if (skipKeys.indexOf(key) === -1) {
            keys.push(key);
        }
    });
    keys = keys.sort();

    var lines = [];
    keys.forEach(function (key) {
        lines.push(format('%s: %s', key, profile[key]));
    });
    return lines.join('\n') + '\n';
}

function _profileFromYamlish(yamlish) {
    assert.string(yamlish, 'yamlish');

    var profile = {};
    var bools = ['insecure'];
    var lines = yamlish.split(/\n/g);
    lines.forEach(function (line) {
        var commentIdx = line.indexOf('#');
        if (commentIdx !== -1) {
            line = line.slice(0, commentIdx);
        }
        line = line.trim();
        if (!line) {
            return;
        }
        var parts = strsplit(line, ':', 2);
        var key = parts[0].trim();
        var value = parts[1].trim();
        if (bools.indexOf(key) !== -1) {
            value = common.boolFromString(value);
        }
        profile[key] = value;
    });

    return profile;
}


function _editProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    if (opts.name === 'env') {
        return cb(new errors.UsageError('cannot edit "env" profile'));
    }

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        return cb(err);
    }

    var filename = format('profile-%s.txt', profile.name);
    var origText = _yamlishFromProfile(profile);

    function editAttempt(text) {
        common.editInEditor({
            text: text,
            filename: filename
        }, function (err, afterText, changed) {
            if (err) {
                return cb(new errors.TritonError(err));
            } else if (!changed) {
                console.log('No change to profile');
                return cb();
            }

            try {
                var editedProfile = _profileFromYamlish(afterText);
                editedProfile.name = profile.name;

                if (_yamlishFromProfile(editedProfile) === origText) {
                    // This YAMLish is the closest to a canonical form we have.
                    console.log('No change to profile');
                    return cb();
                }

                mod_config.saveProfileSync({
                    configDir: cli.configDir,
                    name: opts.name,
                    profile: editedProfile
                });
            } catch (textErr) {
                console.error('Error with your changes: %s', textErr);
                common.promptEnter(
                    'Press <Enter> to re-edit, Ctrl+C to abort.',
                    function (aborted) {
                        if (aborted) {
                            console.log('\nAborting. ' +
                                'No change made to profile');
                            cb();
                        } else {
                            editAttempt(afterText);
                        }
                    });
                return;
            }

            cb();
        });
    }

    editAttempt(origText);
}


function _deleteProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.bool(opts.force, 'opts.force');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    if (opts.name === 'env') {
        return cb(new errors.UsageError('cannot delete "env" profile'));
    }

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        if (opts.force) {
            cb();
        } else {
            cb(err);
        }
        return;
    }

    if (profile.name === cli.tritonapi.profile.name && !opts.force) {
        return cb(new errors.TritonError(
            'cannot delete the current profile (use --force to override)'));
    }

    vasync.pipeline({funcs: [
        function confirm(_, next) {
            if (opts.force) {
                return next();
            }
            common.promptYesNo({
                msg: 'Delete profile "' + opts.name + '"? [y/n] '
            }, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },

        function handleConfigVar(_, next) {
            if (profile.name === cli.tritonapi.profile.name) {
                _currentProfile({name: 'env', cli: cli}, next);
            } else {
                next();
            }
        },

        function deleteIt(_, next) {
            try {
                mod_config.deleteProfile({
                    configDir: cli.configDir,
                    name: opts.name
                });
            } catch (delErr) {
                return next(delErr);
            }
            console.log('Deleted profile "%s"', opts.name);
            next();
        }
    ]}, function (err) {
        if (err === true) {
            err = null;
        }
        cb(err);
    });
}


function _addProfile(opts, cb) {
    //XXX
    cb(new errors.InternalError('_addProfile not yet implemented'));
}



function do_profile(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    // Which action?
    var actions = [];
    if (opts.add) { actions.push('add'); }
    if (opts.current) { actions.push('current'); }
    if (opts.edit) { actions.push('edit'); }
    if (opts['delete']) { actions.push('delete'); }
    var action;
    if (actions.length === 0) {
        action = 'show';
    } else if (actions.length > 1) {
        return cb(new errors.UsageError(
            'only one action option may be used at once'));
    } else {
        action = actions[0];
    }

    // Arg count validation.
    if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    } else if (args.length === 0 &&
        ['current', 'delete'].indexOf(action) !== -1)
    {
        return cb(new errors.UsageError('NAME argument is required'));
    }

    switch (action) {
    case 'show':
        _showProfile({
            cli: this,
            name: args[0] || this.tritonapi.config.profile,
            json: opts.json
        }, cb);
        break;
    case 'current':
        _currentProfile({cli: this, name: args[0]}, cb);
        break;
    case 'edit':
        _editProfile({
            cli: this,
            name: args[0] || this.tritonapi.config.profile
        }, cb);
        break;
    case 'delete':
        _deleteProfile({
            cli: this,
            name: args[0] || this.tritonapi.config.profile,
            force: Boolean(opts.force)
        }, cb);
        break;
    case 'add':
        _addProfile({cli: this, file: args[0]}, cb);
        break;
    default:
        return cb(new errors.InternalError('unknown action: ' + action));
    }
}

do_profile.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output when showing a profile.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Force deletion.'
    },
    {
        group: 'Action Options'
    },
    {
        names: ['current', 'c'],
        type: 'bool',
        help: 'Switch to the named profile.'
    },
    {
        names: ['edit', 'e'],
        type: 'bool',
        help: 'Edit the named profile in your $EDITOR.'
    },
    {
        names: ['add', 'a'],
        type: 'bool',
        help: 'Add a new profile.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete the named profile.'
    }
];

do_profile.help = [
    'Show, add, edit and delete `triton` CLI profiles.',
    '',
    'A profile is a configured Triton CloudAPI endpoint. I.e. the',
    'url, account, key, etc. information required to call a CloudAPI.',
    'You can then switch between profiles with `triton -p PROFILE`',
    'or the TRITON_PROFILE environment variable.',
    '',
    'Usage:',
    '     {{name}} profile [NAME]              # show NAME or current profile',
    '     {{name}} profile -e|--edit [NAME]    # edit a profile in $EDITOR',
    '     {{name}} profile -c|--current NAME   # set NAME as current profile',
    '     {{name}} profile -d|--delete NAME    # delete a profile',
    '     {{name}} profile -a|--add [FILE]     # add a new profile',
    '',
    '{{options}}'
].join('\n');


module.exports = do_profile;
