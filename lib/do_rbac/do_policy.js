/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac policy ...`
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
    {key: 'description'},
    // Want 'rules' last for multiple yamlish repr, see below.
    {key: 'rules', array: true}
];

var CREATE_ROLE_FIELDS = [
    {key: 'name', required: true},
    {key: 'description'},
    {key: 'rules', array: true}
];

function _showPolicy(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    cli.tritonapi.getPolicy({
        id: opts.id
    }, function onPolicy(err, policy) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(policy));
        } else {
            console.log('name: %s', policy.name);
            delete policy.name;
            var rules = policy.rules;
            delete policy.rules;
            Object.keys(policy).forEach(function (key) {
                console.log('%s: %s', key, policy[key]);
            });
            // Do rules last because it is the sole multiline field. The
            // rules can tend to be long, so we want to use multiline output.
            console.log('rules:');
            if (rules && rules.length) {
                console.log('    ' + rules.join('\n    '));
            }
        }
        cb();
    });
}

function _yamlishFromPolicy(policy) {
    assert.object(policy, 'policy');

    var lines = [];
    UPDATABLE_ROLE_FIELDS.forEach(function (field) {
        var key = field.key;
        var val = policy[key];
        if (key === 'rules') {
            lines.push('rules:');
            if (val && val.length) {
                lines.push('    ' + val.join('\n    '));
            }
        } else {
            lines.push(format('%s: %s', key, val));
        }
    });
    return lines.join('\n') + '\n';
}

function _stripYamlishLine(line) {
    var commentIdx = line.indexOf('#');
    if (commentIdx !== -1) {
        line = line.slice(0, commentIdx);
    }
    return line.trim();
}

function _policyFromYamlish(yamlish) {
    assert.string(yamlish, 'yamlish');

    var line;
    var policy = {};
    var lines = yamlish.split(/\n/g);
    for (var i = 0; i < lines.length; i++) {
        line = _stripYamlishLine(lines[i]);
        if (!line) {
            continue;
        }
        var parts = strsplit(line, ':', 2);
        var key = parts[0].trim();
        var value = parts[1].trim();
        if (key === 'rules') {
            var rules = [];
            if (value) {
                rules.push(value);
            }
            // Remaining lines are rules.
            for (var j = i+1; j < lines.length; j++) {
                line = _stripYamlishLine(lines[j]);
                if (!line) {
                    continue;
                }
                rules.push(line);
            }
            policy['rules'] = rules;
            break;
        } else {
            policy[key] = value;
        }
    }

    return policy;
}


function _editPolicy(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.id, 'opts.id');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    var policy;
    var filename;
    var origText;

    function offerRetry(afterText) {
        common.promptEnter(
            'Press <Enter> to re-edit, Ctrl+C to abort.',
            function (aborted) {
                if (aborted) {
                    console.log('\nAborting. No change made to policy.');
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
                var editedPolicy = _policyFromYamlish(afterText);
                editedPolicy.id = policy.id;

                if (_yamlishFromPolicy(editedPolicy) === origText) {
                    // This YAMLish is the closest to a canonical form we have.
                    console.log('No change to policy');
                    cb();
                    return;
                }
            } catch (textErr) {
                console.error('Error with your changes: %s', textErr);
                offerRetry(afterText);
                return;
            }

            // Save changes.
            cli.tritonapi.cloudapi.updatePolicy(editedPolicy,
                    function (uErr, updated) {
                if (uErr) {
                    var prefix = 'Error updating policy with your changes:';
                    var errmsg = uErr.toString();
                    if (errmsg.indexOf('\n') !== -1) {
                        console.error(prefix + '\n' + common.indent(errmsg));
                    } else {
                        console.error(prefix + ' ' + errmsg);
                    }
                    offerRetry(afterText);
                    return;
                }
                console.log('Updated policy "%s" (%s)',
                    updated.name, updated.id);
                cb();
            });
        });
    }


    cli.tritonapi.getPolicy({
        id: opts.id
    }, function onPolicy(err, policy_) {
        if (err) {
            return cb(err);
        }

        policy = policy_;
        filename = format('%s-policy-%s.txt', cli.tritonapi.profile.account,
            policy.name);
        origText = _yamlishFromPolicy(policy);
        editAttempt(origText);
    });
}


function _deletePolicies(opts, cb) {
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
                msg = 'Delete policy "' + opts.ids[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d policies (%s)? [y/n] ',
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
                    cli.tritonapi.deletePolicy({id: id}, function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }
                        console.log('Deleted policy "%s"', id);
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


function _addPolicy(opts, cb) {
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
                    log.trace({stdin: stdin}, 'invalid policy JSON on stdin');
                    return next(new errors.TritonError(
                        format('invalid policy JSON on stdin: %s', err)));
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
                    'invalid policy JSON in "%s": %s', opts.file, err)));
            }
            next();
        },
        function gatherDataInteractive(_, next) {
            if (opts.file) {
                return next();
            } else if (!process.stdin.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create a policy: stdin is not a TTY'));
            } else if (!process.stdout.isTTY) {
                return next(new errors.UsageError('cannot interactively ' +
                    'create a policy: stdout is not a TTY'));
            }

            // TODO: better validation of name, rules
            // TODO: retries on failure
            // TODO: on failure write out to a tmp file with cmd to add it
            data = {};
            vasync.forEachPipeline({
                inputs: CREATE_ROLE_FIELDS,
                func: function getField(field, nextField) {
                    if (field.key === 'rules') {
                        var rules = [];
                        var rulePrompt = {
                            key: 'rule',
                            desc: 'Enter one rule per line. Enter an empty ' +
                                'rule to finish rules. See ' +
                                // JSSTYLED
                                '<https://docs.joyent.com/public-cloud/rbac/rules> ' +
                                'for rule syntax and examples.'
                        };
                        var promptAnotherRule = function () {
                            common.promptField(rulePrompt, function (err, val) {
                                delete rulePrompt.desc; // only want first time
                                if (err) {
                                    nextField(err);
                                } else if (!val) {
                                    // Done rules.
                                    data.rules = rules;
                                    nextField();
                                } else {
                                    rules.push(val);
                                    promptAnotherRule();
                                }
                            });
                        };
                        promptAnotherRule();
                    } else {
                        common.promptField(field, function (err, value) {
                            if (value) {
                                data[field.key] = value;
                            }
                            nextField(err);
                        });
                    }
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
                    'invalid policy data: ' + issues.join('; ')));
            } else {
                next();
            }
        },
        function createIt(_, next) {
            cli.tritonapi.cloudapi.createPolicy(data, function (err, policy) {
                if (err) {
                    next(err);
                    return;
                }
                console.log('Created policy "%s"', policy.name);
                next();
            });
        }
    ]}, cb);
}


function do_policy(subcmd, opts, args, cb) {
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
        return cb(new errors.UsageError('POLICY argument is required'));
    } else if (action !== 'delete' && args.length > 1) {
        return cb(new errors.UsageError('too many arguments'));
    }

    switch (action) {
    case 'show':
        _showPolicy({
            cli: this.top,
            id: args[0],
            json: opts.json
        }, cb);
        break;
    case 'edit':
        _editPolicy({
            cli: this.top,
            id: args[0]
        }, cb);
        break;
    case 'delete':
        _deletePolicies({
            cli: this.top,
            ids: args,
            yes: opts.yes
        }, cb);
        break;
    case 'add':
        _addPolicy({cli: this.top, file: args[0]}, cb);
        break;
    default:
        return cb(new errors.InternalError('unknown action: ' + action));
    }
}

do_policy.options = [
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
        help: 'Edit the named policy in your $EDITOR.'
    },
    {
        names: ['add', 'a'],
        type: 'bool',
        help: 'Add a new policy.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete the named policy.'
    }
];
do_policy.help = [
    /* BEGIN JSSTYLED */
    'Show, add, edit and delete RBAC policies.',
    '',
    'Usage:',
    '     {{name}} policy POLICY                   # show policy POLICY',
    '     {{name}} policy -e|--edit POLICY         # edit policy POLICY in $EDITOR',
    '     {{name}} policy -d|--delete [POLICY...]  # delete policy POLICY',
    '',
    '     {{name}} policy -a|--add [FILE]',
    '             # Add a new policy. FILE must be a file path to a JSON file',
    '             # with the policy data or "-" to pass the policy in on stdin.',
    '             # Or exclude FILE to interactively add.',
    '',
    '{{options}}',
    'Where "POLICY" is a full policy "id", the policy "name" or a "shortid", i.e.',
    'an id prefix.',
    '',
    'Fields for creating a policy:',
    CREATE_ROLE_FIELDS.map(function (field) {
        return '    ' + field.key + (field.required ? ' (required)' : '');
    }).join('\n')
    /* END JSSTYLED */
].join('\n');

module.exports = do_policy;
