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

var POLICY_FIELDS = [
    {key: 'id', hidden: true},
    {key: 'name', required: true}
];

var MEMBER_FIELDS = [
    {key: 'type', required: true, hint: 'subuser/account'},
    {key: 'default', boolean: true, default: true},
    {key: 'id', hidden: true},
    {key: 'login', required: true}
];

var UPDATABLE_ROLE_FIELDS = [
    {key: 'name', required: true},
    {key: 'members', array: true, schema: MEMBER_FIELDS},
    {key: 'policies', array: true, schema: POLICY_FIELDS}
];

var CREATE_ROLE_FIELDS = [
    {key: 'name', required: true},
    {key: 'members', array: true, schema: MEMBER_FIELDS},
    {key: 'policies', array: true, schema: POLICY_FIELDS}
];

var SHOW_ORDER_FIELDS = [
    'id', 'name', 'members', 'policies'
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

    var tritonapi = opts.cli.tritonapi;
    common.cliSetupTritonApi({cli: opts.cli}, function onSetup(setupErr) {
        tritonapi.cloudapi.getRole({id: opts.id}, function onRole(err, role) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(role));
            } else {
                console.log(_yamlishFromRole(role));
            }
            cb();
        });
    });
}

function _yamlishTpl(schema, indent) {
    if (indent === undefined)
        indent = '';
    assert.object(schema, 'schema');
    assert.string(indent, 'indent level');

    var lines = [];
    schema.forEach(function (field) {
        var key = field.key;
        var val = '', comment;
        if (field.hidden)
            return;
        if (field.default !== undefined)
            val = field.default;
        if (field.hint)
            comment = field.hint;
        if (field.boolean) {
            if (val === undefined)
                val = false;
            comment = 'true/false';
        }
        if (field.array) {
            val = [];
            comment = 'val1, val2, ...';
        }
        if (!field.required) {
            if (comment === undefined)
                comment = '';
            comment += ' (optional)';
        }
        if (field.schema) {
            if (!field.array)
                val = [val];
            lines.push(format('%s%s:', indent, key));
            var kidIndent = indent + '  - ';
            lines = lines.concat(_yamlishTpl(field.schema, kidIndent));
        } else {
            if (comment !== undefined)
                lines.push(format('%s%s: %s\t# %s', indent, key, val, comment));
            else
                lines.push(format('%s%s: %s', indent, key, val));
        }
        indent = indent.replace(/-/g, ' ');
    });
    return lines;
}

function _yamlish(schema, obj, indent) {
    if (indent === undefined)
        indent = '';
    assert.object(schema, 'schema');
    assert.object(obj, 'object');
    assert.string(indent, 'indent level');

    var maxKeyLen = 8;
    schema.forEach(function (field) {
        if (field.key.length > maxKeyLen)
            maxKeyLen = field.key.length;
    });

    var lines = [];
    schema.forEach(function (field) {
        var key = field.key;
        var postColonSpaces = ' ';
        while (key.length + postColonSpaces.length < maxKeyLen)
            postColonSpaces += ' ';
        var val = obj[key];
        if (val === undefined && field.boolean)
            val = false;
        if (val === undefined && field.default !== undefined)
            val = field.default;
        if (val === undefined && field.array)
            val = [];
        if ((val === undefined || val === null) && field.hidden)
            return;
        if (val === undefined || val === null)
            val = '';
        if (field.schema) {
            if (!field.array)
                val = [val];
            lines.push(format('%s%s:', indent, key));
            var kidIndent = indent + '  - ';
            val.forEach(function (kid) {
                lines = lines.concat(_yamlish(field.schema, kid, kidIndent));
            });
        } else {
            if (field.array) {
                assert.array(obj, field.key);
                val = val.join(', ');
            }
            lines.push(format('%s%s:%s%s', indent, key, postColonSpaces, val));
        }
        indent = indent.replace(/-/g, ' ');
    });
    return lines;
}

function _yamlishFromRole(role) {
    assert.object(role, 'role');

    var lines = _yamlish(UPDATABLE_ROLE_FIELDS, role);
    return lines.join('\n') + '\n';
}

function _unyamlish(schema, lines, indent) {
    if (indent === undefined)
        indent = '';
    assert.object(schema, 'schema');
    assert.arrayOfString(lines, 'lines');
    assert.string(indent, 'indent level');

    var fieldIdx = {};
    schema.forEach(function (f) {
        fieldIdx[f.key] = f;
    });

    var obj = {};
    while (true) {
        var line = lines.shift();
        if (line === undefined)
            break;
        if (/^\s*#/.test(line))
            continue;
        var commentIdx = line.indexOf('#');
        if (commentIdx !== -1) {
            line = line.slice(0, commentIdx);
        }
        if (line.slice(0, indent.length) !== indent) {
            lines.unshift(line);
            break;
        }
        line = line.slice(indent.length).trim();
        if (line === '') {
            continue;
        }
        if (line.indexOf(':') === -1) {
            throw (new Error('yamlish syntax error: expected <key>:, got ' +
                line));
        }
        var key = line.slice(0, line.indexOf(':'));
        var val = line.slice(key.length + 1).trim();
        var field = fieldIdx[key];
        if (!field) {
            throw (new Error('yamlish error: unknown field "' + key + '"'));
        }
        if (field.schema) {
            if (field.array) {
                val = [];
                var innerIndent = indent + '  - ';
                while (true) {
                    line = lines[0];
                    if (line.slice(0, innerIndent.length) !== innerIndent)
                        break;
                    val.push(_unyamlish(field.schema, lines, innerIndent));
                }
            } else {
                val = _unyamlish(field.schema, lines, indent + '  ');
            }
            obj[key] = val;
        } else {
            if (field.array) {
                /*JSSTYLED*/
                val = val.split(/,[ ]*/g);
            } else {
                val = [val];
            }
            if (field.boolean) {
                val = val.map(function (v) {
                    return (v.toLowerCase() === 'true');
                });
            }
            if (!field.array) {
                val = val[0];
            }
            obj[key] = val;
        }
        indent = indent.replace(/-/g, ' ');
    }

    schema.forEach(function (f) {
        if (obj[f.key] === undefined && f.boolean) {
            obj[f.key] = false;
        }
        if (obj[f.key] === undefined && f.default !== undefined) {
            obj[f.key] = f.default;
        }
        if (obj[f.key] === undefined && f.required) {
            throw (new Error('yamlish error: missing required field "' +
                f.key + '"'));
        }
    });

    return (obj);
}

function _roleFromYamlish(yamlish) {
    assert.string(yamlish, 'yamlish');
    var lines = yamlish.split('\n');
    var role = _unyamlish(UPDATABLE_ROLE_FIELDS, lines);
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

            /* Administrator role isn't allowed with policies. */
            if (editedRole.name === 'administrator') {
                if (editedRole.policies && editedRole.policies.length > 0) {
                    console.error('Error: administrator role must not ' +
                        'contain any policies');
                    offerRetry(afterText);
                    return;
                }
                delete (editedRole.policies);
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

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        cli.tritonapi.cloudapi.getRole({id: opts.id},
            function onRole(err, role_) {
            if (err) {
                return cb(err);
            }

            role = role_;
            filename = format('%s-role-%s.txt', cli.tritonapi.profile.account,
                role.name);
            origText = _yamlishFromRole(role);
            editAttempt(origText);
        });
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

    vasync.pipeline({arg: {cli: opts.cli}, funcs: [
        common.cliSetupTritonApi,
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
    var filename;
    var tplText;

    vasync.pipeline({arg: {cli: opts.cli}, funcs: [
        common.cliSetupTritonApi,
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
            }

            tplText = _yamlishTpl(CREATE_ROLE_FIELDS).join('\n') + '\n';
            filename = format('%s-new-role.txt', cli.tritonapi.profile.account);
            common.editInEditor({
                text: tplText,
                filename: filename
            }, function (err, afterText, changed) {
                if (err) {
                    return next(new errors.TritonError(err));
                }

                try {
                    var role = _roleFromYamlish(afterText);
                } catch (textErr) {
                    return next(textErr);
                }
                delete (role.id);

                /* Administrator role isn't allowed with policies. */
                if (role.name === 'administrator') {
                    if (role.policies && role.policies.length > 0) {
                        next(new Error('administrator role must not ' +
                            'contain any policies'));
                        return;
                    }
                    delete (role.policies);
                }

                data = role;
                return next();
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
