/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac user ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


var UPDATABLE_USER_FIELDS = [
    {key: 'email', required: true},
    {key: 'firstName'},
    {key: 'lastName'},
    {key: 'companyName'},
    {key: 'address'},
    {key: 'postalCode'},
    {key: 'city'},
    {key: 'state'},
    {key: 'country'},
    {key: 'phone'}
];

var CREATE_USER_FIELDS = [
    {key: 'login', required: true},
    {key: 'password', password: true, required: true},
    {key: 'email', required: true},
    {key: 'firstName'},
    {key: 'lastName'},
    {key: 'companyName'},
    {key: 'address'},
    {key: 'postalCode'},
    {key: 'city'},
    {key: 'state'},
    {key: 'country'},
    {key: 'phone'}
];


function _showUser(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.id, 'opts.id');
    assert.optionalBool(opts.roles, 'opts.roles');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    cli.tritonapi.getUser({
        id: opts.id,
        roles: opts.roles
    }, function onUser(err, user) {
        if (err) {
            return cb(err);
        }

        if (opts.json) {
            console.log(JSON.stringify(user));
        } else {
            Object.keys(user).forEach(function (key) {
                console.log('%s: %s', key, user[key]);
            });
        }
        cb();
    });
}

function _yamlishFromUser(user) {
    assert.object(user, 'user');

    var lines = [];
    UPDATABLE_USER_FIELDS.forEach(function (field) {
        lines.push(format('%s: %s', field.key, user[field.key] || ''));
    });
    return lines.join('\n') + '\n';
}

function _userFromYamlish(yamlish) {
    assert.string(yamlish, 'yamlish');

    var user = {};
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
        user[key] = value;
    });

    return user;
}


function _editUser(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    var user;
    var filename;
    var origText;

    function offerRetry(afterText) {
        common.promptEnter(
            'Press <Enter> to re-edit, Ctrl+C to abort.',
            function (aborted) {
                if (aborted) {
                    console.log('\nAborting. No change made to user.');
                    cb();
                } else {
                    editAttempt(afterText);
                }
            });
    }

    function editAttempt(text) {
        common.editInEditor({
            text: text,
            filename: filename
        }, function (err, afterText, changed) {
            if (err) {
                return cb(new errors.TritonError(err));
            }
            // We don't use this `changed` in case it is a second attempt.

            try {
                var editedUser = _userFromYamlish(afterText);
                editedUser.id = user.id;

                if (_yamlishFromUser(editedUser) === origText) {
                    // This YAMLish is the closest to a canonical form we have.
                    console.log('No change to user');
                    cb();
                    return;
                }
            } catch (textErr) {
                console.error('Error with your changes: %s', textErr);
                offerRetry(afterText);
                return;
            }

            // Save changes.
            cli.tritonapi.cloudapi.updateUser(editedUser, function (uErr, uu) {
                if (uErr) {
                    console.error('Error updating user with your changes: %s',
                        uErr);
                    offerRetry(afterText);
                    return;
                }
                console.log('Updated user "%s"', uu.login);
                cb();
            });
        });
    }


    cli.tritonapi.getUser({
        id: opts.id,
        roles: opts.roles
    }, function onUser(err, user_) {
        if (err) {
            return cb(err);
        }

        user = user_;
        filename = format('user-%s-%s.txt', cli.account, user.login);
        origText = _yamlishFromUser(user);
        editAttempt(origText);
    });
}


function _deleteUsers(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
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
                msg = 'Delete user "' + opts.ids[0] + '"? [y/n] ';
            } else {
                msg = 'Delete %d users (' + opts.ids.join(', ') + ')? [y/n] ';

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
                    cli.tritonapi.cloudapi.deleteUser({id: id}, function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }
                        console.log('Deleted user "%s"', id);
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


function _addUser(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.optionalString(opts.file, 'opts.file');
    assert.func(cb, 'cb');
    var cli = opts.cli;
    var log = cli.log;

    var data;

    vasync.pipeline({funcs: [
        function gatherDataStdin(_, next) {
            if (opts.file !== '-') {
                return next();
            }
            var stdin = '';
            process.stdin.resume();
            process.stdin.on('data', function (chunk) {
                stdin += chunk;
            });
            process.stdin.on('end', function () {
                try {
                    data = JSON.parse(stdin);
                } catch (err) {
                    log.trace({stdin: stdin}, 'invalid user JSON on stdin');
                    return next(new errors.TritonError(
                        format('invalid user JSON on stdin: %s', err)));
                }
                next();
            });
        },
        function gatherDataFile(_, next) {
            if (!opts.file || opts.file === '-') {
                return next();
            }
            var input = fs.readFileSync(opts.file);
            try {
                data = JSON.parse(input);
            } catch (err) {
                return next(new errors.TritonError(format(
                    'invalid user JSON in "%s": %s', opts.file, err)));
            }
            next();
        },
        function gatherDataInteractive(_, next) {
            if (opts.file) {
                return next();
            } else if (!process.stdin.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create a user: stdin is not a TTY'));
            } else if (!process.stdout.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create a user: stdout is not a TTY'));
            }

            // TODO: confirm password
            // TODO: some validation on login, email, password complexity
            // TODO: retries on failure
            // TODO: on failure write out to a tmp file with cmd to add it
            data = {};
            vasync.forEachPipeline({
                inputs: CREATE_USER_FIELDS,
                func: function getField(field, nextField) {
                    common.promptField(field, function (err, value) {
                        if (value) {
                            data[field.key] = value;
                        }
                        nextField(err);
                    });
                }
            }, function (err) {
                console.log();
                next(err);
            });
        },
        function validateData(_, next) {
            var missing = [];
            var dataCopy = common.objCopy(data);
            CREATE_USER_FIELDS.forEach(function (field) {
                if (dataCopy.hasOwnProperty(field.key)) {
                    delete dataCopy[field.key];
                } else if (field.required) {
                    missing.push(field.key);
                }
            });
            var extra = Object.keys(dataCopy);
            var issues = [];
            if (missing.length) {
                issues.push(format('%s missing required field%s: %s',
                    missing.length, (missing.length === 1 ? '' : 's'),
                    missing.join(', ')));
            }
            if (extra.length) {
                issues.push(format('extraneous field%s: %s',
                    (extra.length === 1 ? '' : 's'), extra.join(', ')));
            }
            if (issues.length) {
                next(new errors.TritonError(
                    'invalid user data: ' + issues.join('; ')));
            } else {
                next();
            }
        },
        function createIt(_, next) {
            cli.tritonapi.cloudapi.createUser(data, function (err, user) {
                if (err) {
                    next(err);
                    return;
                }
                console.log('Created user "%s"', user.login);
                next();
            });
        }
    ]}, cb);
}


function do_user(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    // Which action?
    var actions = [];
    if (opts.add) { actions.push('add'); }
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
        ['show', 'edit'].indexOf(action) !== -1)
    {
        return cb(new errors.UsageError('USER argument is required'));
    }

    switch (action) {
    case 'show':
        _showUser({
            cli: this.top,
            id: args[0],
            roles: opts.roles || opts.membership,
            json: opts.json
        }, cb);
        break;
    case 'edit':
        // TODO: support `triton rbac user trent -e companyName=Tuna` k=v args
        _editUser({
            cli: this.top,
            id: args[0]
        }, cb);
        break;
    case 'delete':
        _deleteUsers({
            cli: this.top,
            ids: args,
            yes: opts.yes
        }, cb);
        break;
    case 'add':
        _addUser({cli: this.top, file: args[0]}, cb);
        break;
    default:
        return cb(new errors.InternalError('unknown action: ' + action));
    }
}

do_user.options = [
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
        names: ['roles', 'r'],
        type: 'bool',
        help: 'Include "roles" and "default_roles" this user has.'
    },
    {
        names: ['membership'],
        type: 'bool',
        help: 'Include "roles" and "default_roles" this user has. Included ' +
            'for backward compat with `sdc-user get --membership ...` from ' +
            'node-smartdc.',
        hidden: true
    },
    {
        names: ['yes', 'y'],
        type: 'bool',
        help: 'Answer yes to confirmations, e.g. confirmation of deletion.'
    },
    {
        group: 'Action Options'
    },
    {
        names: ['edit', 'e'],
        type: 'bool',
        help: 'Edit the named user in your $EDITOR.'
    },
    {
        names: ['add', 'a'],
        type: 'bool',
        help: 'Add a new user.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete the named user.'
    }
];
do_user.help = [
    /* BEGIN JSSTYLED */
    'Show, add, edit and delete RBAC users.',
    '',
    'Usage:',
    '     {{name}} user USER                   # show user USER',
    '     {{name}} user -e|--edit USER         # edit user USER in $EDITOR',
    '     {{name}} user -d|--delete [USER...]  # delete user USER',
    '',
    '     {{name}} user -a|--add [FILE]',
    '             # Add a new user. FILE must be a file path to a JSON file',
    '             # with the user data or "-" to pass the user in on stdin.',
    '             # Or exclude FILE to interactively add.',
    '',
    '{{options}}',
    'Where "USER" is a full user "id", the user "login" name or a "shortid", i.e.',
    'an id prefix.',
    '',
    'Fields for creating a user:',
    CREATE_USER_FIELDS.map(function (field) {
        return '    ' + field.key + (field.required ? ' (required)' : '');
    }).join('\n')
    /* END JSSTYLED */
].join('\n');

module.exports = do_user;
