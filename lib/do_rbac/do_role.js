/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac role ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


var UPDATABLE_ROLE_FIELDS = [
    {key: 'name', required: true},
    {key: 'default_members', array: true},
    {key: 'members', array: true},
    {key: 'policies', array: true}
];

var CREATE_ROLE_FIELDS = [
    {key: 'name', required: true},
    {key: 'default_members', array: true},
    {key: 'members', array: true},
    {key: 'policies', array: true}
];

var SHOW_ORDER_FIELDS = [
    'id', 'name', 'default_members', 'members', 'policies'
];

var _isArrayFromKey = {};
UPDATABLE_ROLE_FIELDS.forEach(function (field) {
    _isArrayFromKey[field.key] = Boolean(field.array);
});


function _arrayFromCSV(csv) {
    // JSSTYLED
    return csv.split(/\s*,\s*/g).filter(function (v) { return v; });
}


function _showRole(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    cli.tritonapi.cloudapi.getRole({id: opts.id}, function onRole(err, role) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(role));
        } else {
            var keys = Object.keys(role);
            keys.sort(function cmpKeys(a, b) {
                var idxA = SHOW_ORDER_FIELDS.indexOf(a);
                var idxB = SHOW_ORDER_FIELDS.indexOf(b);
                if (idxA === -1 && idxB === -1) {
                    return 0;
                } else if (idxA === -1) {
                    return -1;
                } else if (idxB === -1) {
                    return 1;
                } else if (idxA < idxB) {
                    return -1;
                } else if (idxA > idxB) {
                    return 1;
                }
            });

            keys.forEach(function (key) {
                var val = role[key];
                if (Array.isArray(val)) {
                    val = val.join(', ');
                }
                console.log('%s: %s', key, val);
            });
        }
        cb();
    });
}

function _yamlishFromRole(role) {
    assert.object(role, 'role');

    var lines = [];
    UPDATABLE_ROLE_FIELDS.forEach(function (field) {
        var key = field.key;
        var val = role[key];
        if (!val) {
            val = '';
        } else if (Array.isArray(val)) {
            val = val.join(', ');
        }
        lines.push(format('%s: %s', key, val));
    });
    return lines.join('\n') + '\n';
}

function _roleFromYamlish(yamlish) {
    assert.string(yamlish, 'yamlish');

    var role = {};
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
        if (_isArrayFromKey[key]) {
            value = _arrayFromCSV(value);
        }
        role[key] = value;
    });

    return role;
}


function _editRole(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    var role;
    var filename;
    var origText;

    function offerRetry(afterText) {
        common.promptEnter(
            'Press <Enter> to re-edit, Ctrl+C to abort.',
            function (aborted) {
                if (aborted) {
                    console.log('\nAborting. No change made to role.');
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
                var editedRole = _roleFromYamlish(afterText);
                editedRole.id = role.id;

                if (_yamlishFromRole(editedRole) === origText) {
                    // This YAMLish is the closest to a canonical form we have.
                    console.log('No change to role');
                    cb();
                    return;
                }
            } catch (textErr) {
                console.error('Error with your changes: %s', textErr);
                offerRetry(afterText);
                return;
            }

            // Save changes.
            cli.tritonapi.cloudapi.updateRole(editedRole, function (uErr, ur) {
                if (uErr) {
                    console.error('Error updating role with your changes: %s',
                        uErr);
                    offerRetry(afterText);
                    return;
                }
                console.log('Updated role "%s" (%s)', ur.name, ur.id);
                cb();
            });
        });
    }


    cli.tritonapi.cloudapi.getRole({id: opts.id}, function onRole(err, role_) {
        if (err) {
            return cb(err);
        }

        role = role_;
        filename = format('%s-role-%s.txt', cli.tritonapi.profile.account,
            role.name);
        origText = _yamlishFromRole(role);
        editAttempt(origText);
    });
}


function _deleteRoles(opts, cb) {
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
                msg = 'Delete role "' + opts.ids[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d roles (%s)? [y/n] ',
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
                    cli.tritonapi.deleteRole({id: id}, function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }
                        console.log('Deleted role "%s"', id);
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


function _addRole(opts, cb) {
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

            common.readStdin(function gotStdin(stdin) {
                try {
                    data = JSON.parse(stdin);
                } catch (err) {
                    log.trace({stdin: stdin}, 'invalid role JSON on stdin');
                    return next(new errors.TritonError(
                        format('invalid role JSON on stdin: %s', err)));
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
                    'invalid role JSON in "%s": %s', opts.file, err)));
            }
            next();
        },
        function gatherDataInteractive(_, next) {
            if (opts.file) {
                return next();
            } else if (!process.stdin.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create a role: stdin is not a TTY'));
            } else if (!process.stdout.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create a role: stdout is not a TTY'));
            }

            // TODO: retries on failure
            // TODO: on failure write out to a tmp file with cmd to add it
            data = {};
            vasync.forEachPipeline({
                inputs: CREATE_ROLE_FIELDS,
                func: function getField(field_, nextField) {
                    var field = common.objCopy(field_);

                    // 'members' needs to hold all default_members, so default
                    // that.
                    if (field.key === 'members') {
                        field['default'] = data['default_members'].join(', ');
                    }

                    common.promptField(field, function (err, value) {
                        if (value) {
                            if (_isArrayFromKey[field.key]) {
                                value = _arrayFromCSV(value);
                            }
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
            CREATE_ROLE_FIELDS.forEach(function (field) {
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
                    'invalid role data: ' + issues.join('; ')));
            } else {
                next();
            }
        },
        function createIt(_, next) {
            cli.tritonapi.cloudapi.createRole(data, function (err, role) {
                if (err) {
                    next(err);
                    return;
                }
                console.log('Created role "%s"', role.name);
                next();
            });
        }
    ]}, cb);
}


function do_role(subcmd, opts, args, cb) {
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
    if (args.length === 0 && ['show', 'edit'].indexOf(action) !== -1) {
        return cb(new errors.UsageError('ROLE argument is required'));
    } else if (action !== 'delete' && args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    switch (action) {
    case 'show':
        _showRole({
            cli: this.top,
            id: args[0],
            json: opts.json
        }, cb);
        break;
    case 'edit':
        _editRole({
            cli: this.top,
            id: args[0]
        }, cb);
        break;
    case 'delete':
        _deleteRoles({
            cli: this.top,
            ids: args,
            yes: opts.yes
        }, cb);
        break;
    case 'add':
        _addRole({cli: this.top, file: args[0]}, cb);
        break;
    default:
        return cb(new errors.InternalError('unknown action: ' + action));
    }
}

do_role.options = [
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
        help: 'Answer yes to confirmations, e.g. confirmation of deletion.'
    },
    {
        group: 'Action Options'
    },
    {
        names: ['edit', 'e'],
        type: 'bool',
        help: 'Edit the named role in your $EDITOR.'
    },
    {
        names: ['add', 'a'],
        type: 'bool',
        help: 'Add a new role.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete the named role.'
    }
];

do_role.synopses = [
    '{{name}} {{cmd}} ROLE                   # show role ROLE',
    '{{name}} {{cmd}} -e|--edit ROLE         # edit role ROLE in $EDITOR',
    '{{name}} {{cmd}} -d|--delete [ROLE...]  # delete role ROLE',
    '{{name}} {{cmd}} -a|--add [FILE]        # add a new role'
];

do_role.help = [
    /* BEGIN JSSTYLED */
    'Show, add, edit and delete RBAC roles.',
    '',
    'Usage:',
    '     {{name}} {{cmd}} ROLE                   # show role ROLE',
    '     {{name}} {{cmd}} -e|--edit ROLE         # edit role ROLE in $EDITOR',
    '     {{name}} {{cmd}} -d|--delete [ROLE...]  # delete role ROLE',
    '',
    '     {{name}} {{cmd}} -a|--add [FILE]',
    '             # Add a new role. FILE must be a file path to a JSON file',
    '             # with the role data or "-" to pass the role in on stdin.',
    '             # Or exclude FILE to interactively add.',
    '',
    '{{options}}',
    'Where "ROLE" is a full role "id", the role "name" or a "shortid", i.e.',
    'an id prefix.',
    '',
    'Fields for creating a role:',
    CREATE_ROLE_FIELDS.map(function (field) {
        return '    ' + field.key + (field.required ? ' (required)' : '');
    }).join('\n')
    /* END JSSTYLED */
].join('\n');

module.exports = do_role;
