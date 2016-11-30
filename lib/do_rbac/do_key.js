/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac key ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var sshpk = require('sshpk');
var strsplit = require('strsplit');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function _showUserKey(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    cli.tritonapi.cloudapi.getUserKey({
        userId: opts.userId,
        // Currently `cloudapi.getUserKey` isn't picky about the `name` being
        // passed in as the `opts.fingerprint` arg.
        fingerprint: opts.id
    }, function onUserKey(err, userKey) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(userKey));
        } else {
            console.log(common.chomp(userKey.key));
        }
        cb();
    });
}

function _deleteUserKeys(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.arrayOfString(opts.ids, 'opts.ids');
    assert.optionalBool(opts.yes, 'opts.yes');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    if (opts.ids.length === 0) {
        cb();
        return;
    }

    vasync.pipeline({funcs: [
        function confirm(_, next) {
            if (opts.yes) {
                return next();
            }
            var msg;
            if (opts.ids.length === 1) {
                msg = 'Delete user key "' + opts.ids[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d user keys (%s)? [y/n] ',
                    opts.ids.length, opts.ids.join(', '));
            }
            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },
        function deleteThem(_, next) {
            vasync.forEachPipeline({
                inputs: opts.ids,
                func: function deleteOne(id, nextId) {
                    var delOpts = {
                        userId: opts.userId,
                        fingerprint: id
                    };
                    cli.tritonapi.cloudapi.deleteUserKey(delOpts,
                            function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }
                        console.log('Deleted user %s key "%s"',
                            opts.userId, id);
                        nextId();
                    });
                }
            }, next);
        }
    ]}, function (err) {
        if (err === true) {
            err = null;
        }
        cb(err);
    });
}


function _addUserKey(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.string(opts.file, 'opts.file');
    assert.optionalString(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    vasync.pipeline({arg: {}, funcs: [
        function gatherDataStdin(ctx, next) {
            if (opts.file !== '-') {
                return next();
            }
            var stdin = '';
            process.stdin.resume();
            process.stdin.on('data', function (chunk) {
                stdin += chunk;
            });
            process.stdin.on('end', function () {
                ctx.data = stdin;
                ctx.from = '<stdin>';
                next();
            });
        },
        function gatherDataFile(ctx, next) {
            if (!opts.file || opts.file === '-') {
                return next();
            }
            ctx.data = fs.readFileSync(opts.file);
            ctx.from = opts.file;
            next();
        },
        function validateData(ctx, next) {
            try {
                sshpk.parseKey(ctx.data, 'ssh', ctx.from);
            } catch (keyErr) {
                next(keyErr);
                return;
            }
            next();
        },
        function createIt(ctx, next) {
            var createOpts = {
                userId: opts.userId,
                key: ctx.data.toString('utf8')
            };
            if (opts.name) {
                createOpts.name = opts.name;
            }
            cli.tritonapi.cloudapi.createUserKey(createOpts,
                    function (err, userKey) {
                if (err) {
                    next(err);
                    return;
                }
                var extra = '';
                if (userKey.name) {
                    extra = format(' (%s)', userKey.name);
                }
                console.log('Added user %s key "%s"%s',
                    opts.userId, userKey.fingerprint, extra);
                next();
            });
        }
    ]}, cb);
}


function do_key(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    // Which action?
    var actions = [];
    if (opts.add) { actions.push('add'); }
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
    if (action === 'show') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER and KEY arguments'));
            return;
        } else if (args.length === 1) {
            cb(new errors.UsageError('missing KEY argument'));
            return;
        } else if (args.length > 2) {
            cb(new errors.UsageError('incorrect number of arguments'));
            return;
        }
    } else if (action === 'delete') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER argument'));
            return;
        }
    } else if (action === 'add') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER and FILE arguments'));
            return;
        } else if (args.length === 1) {
            cb(new errors.UsageError('missing FILE argument'));
            return;
        } else if (args.length > 2) {
            cb(new errors.UsageError('incorrect number of arguments'));
            return;
        }
    }

    switch (action) {
    case 'show':
        _showUserKey({
            cli: this.top,
            userId: args[0],
            id: args[1],
            json: opts.json
        }, cb);
        break;
    case 'delete':
        _deleteUserKeys({
            cli: this.top,
            userId: args[0],
            ids: args.slice(1),
            yes: opts.yes
        }, cb);
        break;
    case 'add':
        _addUserKey({
            cli: this.top,
            name: opts.name,
            userId: args[0],
            file: args[1]
        }, cb);
        break;
    default:
        return cb(new errors.InternalError('unknown action: ' + action));
    }
}

do_key.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer yes to confirmation to delete.'
    },
    {
        names: ['name', 'n'],
        type: 'string',
        helpArg: 'NAME',
        help: 'An optional name for an added key.'
    },
    {
        group: 'Action Options'
    },
    {
        names: ['add', 'a'],
        type: 'bool',
        help: 'Add a new key.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete the named key.'
    }
];

do_key.synopses = [
    '{{name}} {{cmd}} USER KEY                     # show USER\'s KEY',
    '{{name}} {{cmd}} -d|--delete USER [KEY...]    # delete USER\'s KEY',
    '{{name}} {{cmd}} -a|--add [-n NAME] USER FILE # add an SSH key'
];

do_key.help = [
    /* BEGIN JSSTYLED */
    'Show, upload, and delete RBAC user SSH keys.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "USER" is a full RBAC user "id", "login" name or a "shortid"; and',
    'KEY is an SSH key "name" or "fingerprint". FILE must be a file path to',
    'an SSH public key or "-" to pass the public key in on stdin.'
    /* END JSSTYLED */
].join('\n');

module.exports = do_key;
