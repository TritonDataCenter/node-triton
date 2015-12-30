/*
 * Copyright (c) 2015 Joyent Inc.
 *
 * `triton profile delete ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var mod_config = require('../config');
var profilecommon = require('./profilecommon');



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

        // If we are deleting the current profile, then revert the current
        // profile to 'env'.
        function handleConfigVar(_, next) {
            if (profile.name === cli.tritonapi.profile.name) {
                profilecommon.setCurrentProfile({name: 'env', cli: cli}, next);
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


function do_delete(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        return cb(new errors.UsageError('NAME argument is required'));
    }

    _deleteProfile({
        cli: this.top,
        name: args[0],
        force: Boolean(opts.force)
    }, cb);
}

do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Force deletion.'
    }
];

do_delete.help = [
    'Delete a Triton CLI profile.',
    '',
    'Usage:',
    '    {{name}} delete NAME',
    '',
    '{{options}}'
].join('\n');


do_delete.aliases = ['rm'];

module.exports = do_delete;
