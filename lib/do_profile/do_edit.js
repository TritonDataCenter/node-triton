/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profile edit ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var strsplit = require('strsplit');

var common = require('../common');
var errors = require('../errors');
var mod_config = require('../config');


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
            filename: filename,
            log: cli.log
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


function do_edit(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    _editProfile({
        cli: this.top,
        name: args[0] || this.top.tritonapi.profile.name
    }, cb);
}

do_edit.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_edit.synopses = ['{{name}} {{cmd}} [PROFILE]'];
do_edit.help = [
    'Edit a Triton CLI profile in your $EDITOR.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_edit.completionArgtypes = ['tritonprofile', 'none'];

module.exports = do_edit;
