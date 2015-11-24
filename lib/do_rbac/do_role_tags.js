/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac role-tags ...`
 * `triton rbac instance-role-tags ...`
 * `triton rbac image-role-tags ...`
 * `triton rbac package-role-tags ...`
 * `triton rbac network-role-tags ...`
 * etc.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


// ---- internal support stuff

function _reprFromRoleTags(roleTags) {
    assert.arrayOfString(roleTags, 'roleTags');

    if (roleTags.length === 0) {
        return '';
    }

    // Make this somewhat canonical by sorting.
    roleTags.sort();
    return roleTags.join('\n') + '\n';
}


function _roleTagsFromRepr(repr) {
    assert.string(repr, 'repr');

    var roleTags = [];
    var lines = repr.split(/\n/g);
    lines.forEach(function (line) {
        var commentIdx = line.indexOf('#');
        if (commentIdx !== -1) {
            line = line.slice(0, commentIdx);
        }
        line = line.trim();
        if (!line) {
            return;
        }
        roleTags.push(line);
    });

    roleTags.sort();
    return roleTags;
}



function _listRoleTags(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.resourceType, 'opts.resourceType');
    assert.string(opts.resourceId, 'opts.resourceId');
    assert.optionalBool(opts.json, 'opts.json');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    cli.tritonapi.getRoleTags({
        resourceType: opts.resourceType,
        id: opts.resourceId
    }, function (err, roleTags) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(roleTags));
        } else {
            roleTags.forEach(function (r) {
                console.log(r);
            });
        }
        cb();
    });
}

function _addRoleTags(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.resourceType, 'opts.resourceType');
    assert.string(opts.resourceId, 'opts.resourceId');
    assert.arrayOfString(opts.roleTags, 'opts.roleTags');
    assert.func(cb, 'cb');
    var cli = opts.cli;
    var log = cli.log;

    vasync.pipeline({arg: {}, funcs: [
        function getCurrRoleTags(ctx, next) {
            cli.tritonapi.getRoleTags({
                resourceType: opts.resourceType,
                id: opts.resourceId
            }, function (err, roleTags, resource) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.roleTags = roleTags;
                ctx.resource = resource;
                log.trace({resource: resource, roleTags: roleTags},
                    'curr role tags');
                next();
            });
        },

        function addRoleTags(ctx, next) {
            var adding = [];
            for (var i = 0; i < opts.roleTags.length; i++) {
                var r = opts.roleTags[i];
                if (ctx.roleTags.indexOf(r) === -1) {
                    ctx.roleTags.push(r);
                    adding.push(r);
                }
            }
            if (adding.length === 0) {
                next();
                return;
            } else {
                console.log('Adding %d role tag%s (%s) to %s "%s"',
                    adding.length, adding.length === 1 ? '' : 's',
                    adding.join(', '), opts.resourceType,
                    opts.resourceId);
            }
            cli.tritonapi.setRoleTags({
                resourceType: opts.resourceType,
                id: (opts.resourceType === 'resource'
                    ? opts.resourceId : ctx.resource.id),
                roleTags: ctx.roleTags
            }, next);
        }
    ]}, function (err) {
        cb(err);
    });
}


function _editRoleTags(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.resourceType, 'opts.resourceType');
    assert.string(opts.resourceId, 'opts.resourceId');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    var roleTags;
    var filename;
    var origText;

    function offerRetry(afterText) {
        common.promptEnter(
            'Press <Enter> to re-edit, Ctrl+C to abort.',
            function (aborted) {
                if (aborted) {
                    console.log('\nAborting. No change made.');
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
                var edited = _roleTagsFromRepr(afterText);

                if (_reprFromRoleTags(edited) === origText) {
                    // This repr is the closest to a canonical form we have.
                    console.log('No change');
                    cb();
                    return;
                }
            } catch (textErr) {
                console.error('Error with your changes: %s', textErr);
                offerRetry(afterText);
                return;
            }

            // Save changes.
            cli.tritonapi.setRoleTags({
                resourceType: opts.resourceType,
                id: opts.resourceId,
                roleTags: edited
            }, function (setErr) {
                if (setErr) {
                    console.error('Error updating role tags with ' +
                        'your changes: %s', setErr);
                    offerRetry(afterText);
                    return;
                }
                console.log('Edited role tags on %s "%s"',
                    opts.resourceType, opts.resourceId);
                cb();
            });
        });
    }


    cli.tritonapi.getRoleTags({
        resourceType: opts.resourceType,
        id: opts.resourceId
    }, function (err, roleTags_) {
        if (err) {
            cb(err);
            return;
        }

        roleTags = roleTags_;
        filename = format('%s-%s-%s-roleTags.txt',
            cli.tritonapi.profile.account,
            opts.resourceType,
            common.filenameSlug(opts.resourceId));
        origText = _reprFromRoleTags(roleTags);
        editAttempt(origText);
    });
}


function _setRoleTags(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.resourceType, 'opts.resourceType');
    assert.string(opts.resourceId, 'opts.resourceId');
    assert.arrayOfString(opts.roleTags, 'opts.roleTags');
    assert.optionalBool(opts.yes, 'opts.yes');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    vasync.pipeline({arg: {}, funcs: [
        function confirm(ctx, next) {
            if (opts.yes) {
                return next();
            }
            var msg = format('Set role tags on %s "%s"? [y/n] ',
                opts.resourceType, opts.resourceId);
            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },

        function setThem(ctx, next) {
            console.log('Setting role tags on %s "%s"',
                opts.resourceType, opts.resourceId);
            cli.tritonapi.setRoleTags({
                resourceType: opts.resourceType,
                id: opts.resourceId,
                roleTags: opts.roleTags
            }, next);
        }
    ]}, function (err) {
        cb(err);
    });
}



function _deleteRoleTags(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.resourceType, 'opts.resourceType');
    assert.string(opts.resourceId, 'opts.resourceId');
    assert.arrayOfString(opts.roleTags, 'opts.roleTags');
    assert.func(cb, 'cb');
    var cli = opts.cli;
    var log = cli.log;

    vasync.pipeline({arg: {}, funcs: [
        function getCurrRoleTags(ctx, next) {
            cli.tritonapi.getRoleTags({
                resourceType: opts.resourceType,
                id: opts.resourceId
            }, function (err, roleTags, resource) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.roleTags = roleTags;
                ctx.resource = resource;
                log.trace({resource: resource, roleTags: roleTags},
                    'curr role tags');
                next();
            });
        },

        function determineToDelete(ctx, next) {
            ctx.toDelete = [];
            ctx.roleTagsToKeep = [];
            for (var i = 0; i < ctx.roleTags.length; i++) {
                var r = ctx.roleTags[i];
                if (opts.roleTags.indexOf(r) !== -1) {
                    ctx.toDelete.push(r);
                } else {
                    ctx.roleTagsToKeep.push(r);
                }
            }
            next();
        },

        function confirm(ctx, next) {
            if (ctx.toDelete.length === 0 || opts.yes) {
                return next();
            }
            var msg = format(
                'Delete %d role tag%s (%s) from %s "%s"? [y/n] ',
                ctx.toDelete.length, ctx.toDelete.length === 1 ? '' : 's',
                ctx.toDelete.join(', '),
                opts.resourceType, opts.resourceId);
            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },

        function deleteRoleTags(ctx, next) {
            if (ctx.toDelete.length === 0) {
                next();
                return;
            }
            console.log('Deleting %d role tag%s (%s) from %s "%s"',
                ctx.toDelete.length, ctx.toDelete.length === 1 ? '' : 's',
                ctx.toDelete.join(', '),
                opts.resourceType, opts.resourceId);
            cli.tritonapi.setRoleTags({
                resourceType: opts.resourceType,
                id: (opts.resourceType === 'resource'
                    ? opts.resourceId : ctx.resource.id),
                roleTags: ctx.roleTagsToKeep
            }, next);
        }
    ]}, function (err) {
        cb(err);
    });
}


function _deleteAllRoleTags(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.resourceType, 'opts.resourceType');
    assert.string(opts.resourceId, 'opts.resourceId');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    vasync.pipeline({arg: {}, funcs: [
        function confirm(ctx, next) {
            if (opts.yes) {
                return next();
            }
            var msg = format('Delete all role tags from %s "%s"? [y/n] ',
                opts.resourceType, opts.resourceId);
            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true); // early abort signal
                } else {
                    next();
                }
            });
        },

        function deleteAllRoleTags(ctx, next) {
            console.log('Deleting all role tags from %s "%s"',
                opts.resourceType, opts.resourceId);
            cli.tritonapi.setRoleTags({
                resourceType: opts.resourceType,
                id: opts.resourceId,
                roleTags: []
            }, next);
        }
    ]}, function (err) {
        cb(err);
    });
}


function _roleTagsFromArrayOfString(arr) {
    assert.arrayOfString(arr, arr);
    var allRoleTags = [];
    for (var i = 0; i < arr.length; i++) {
        var roleTags = arr[i]
            /* JSSTYLED */
            .split(/\s*,\s*/)
            .filter(function (r) { return r.trim(); });
        allRoleTags = allRoleTags.concat(roleTags);
    }
    return allRoleTags;
}


function makeRoleTagsFunc(cfg) {
    assert.string(cfg.resourceType, 'cfg.resourceType');
    assert.string(cfg.funcName, 'cfg.funcName');
    assert.string(cfg.cmdName, 'cfg.cmdName');
    assert.string(cfg.argName, 'cfg.argName');
    assert.string(cfg.helpArgIs, 'cfg.helpArgIs');

    var func = function (subcmd, opts, args, cb) {
        if (opts.help) {
            this.do_help('help', {}, [subcmd], cb);
            return;
        }

        // Which action?
        var actions = [];
        if (opts.add) { actions.push('add'); }
        if (opts.edit) { actions.push('edit'); }
        if (opts.set) { actions.push('set'); }
        if (opts['delete']) { actions.push('delete'); }
        if (opts.delete_all) { actions.push('deleteAll'); }
        var action;
        if (actions.length === 0) {
            action = 'list';
        } else if (actions.length > 1) {
            return cb(new errors.UsageError(
                'only one action option may be used at once'));
        } else {
            action = actions[0];
        }

        // Arg count validation.
        if (args.length === 0) {
            return cb(new errors.UsageError(cfg.argName +
                ' argument is required'));
        } else if (args.length > 1) {
            return cb(new errors.UsageError('too many arguments'));
        }

        switch (action) {
        case 'list':
            _listRoleTags({
                cli: this.top,
                resourceType: cfg.resourceType,
                resourceId: args[0],
                json: opts.json
            }, cb);
            break;
        case 'add':
            _addRoleTags({
                cli: this.top,
                resourceType: cfg.resourceType,
                resourceId: args[0],
                roleTags: _roleTagsFromArrayOfString(opts.add)
            }, cb);
            break;
        case 'edit':
            _editRoleTags({
                cli: this.top,
                resourceType: cfg.resourceType,
                resourceId: args[0]
            }, cb);
            break;
        case 'set':
            _setRoleTags({
                cli: this.top,
                resourceType: cfg.resourceType,
                resourceId: args[0],
                roleTags: _roleTagsFromArrayOfString(opts.set),
                yes: opts.yes
            }, cb);
            break;
        case 'delete':
            _deleteRoleTags({
                cli: this.top,
                resourceType: cfg.resourceType,
                resourceId: args[0],
                roleTags: _roleTagsFromArrayOfString(opts['delete']),
                yes: opts.yes
            }, cb);
            break;
        case 'deleteAll':
            _deleteAllRoleTags({
                cli: this.top,
                resourceType: cfg.resourceType,
                resourceId: args[0],
                yes: opts.yes
            }, cb);
            break;
        default:
            return cb(new errors.InternalError('unknown action: ' + action));
        }
    };

    func.name = cfg.funcName;

    func.options = [
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
            names: ['add', 'a'],
            type: 'arrayOfString',
            helpArg: 'ROLE[,ROLE...]',
            help: 'Add the given role tags. Can be specified multiple times.'
        },
        {
            names: ['set', 's'],
            type: 'arrayOfString',
            helpArg: 'ROLE[,ROLE...]',
            help: 'Set role tags to the given value(s). Can be specified ' +
                'multiple times.'
        },
        {
            names: ['edit', 'e'],
            type: 'bool',
            help: 'Edit role tags in your $EDITOR.'
        },
        {
            names: ['delete', 'd'],
            type: 'arrayOfString',
            helpArg: 'ROLE[,ROLE...]',
            help: 'Delete the given role tags. Can be specified multiple times.'
        },
        {
            names: ['delete-all', 'D'],
            type: 'bool',
            help: 'Delete all role tags from the given resource.'
        }
    ];

    func.helpOpts = {
        helpCol: 23
    };

    func.help = [
        /* BEGIN JSSTYLED */
        'List and manage role tags for the given $resourceType.',
        '',
        'Usage:',
        '     {{name}} $cmdName $argName                      # list role tags',
        '     {{name}} $cmdName -a ROLE[,ROLE...] $argName    # add',
        '     {{name}} $cmdName -s ROLE[,ROLE...] $argName    # set/replace',
        '     {{name}} $cmdName -e $argName                   # edit in $EDITOR',
        '     {{name}} $cmdName -d ROLE[,ROLE...] $argName    # delete',
        '     {{name}} $cmdName -D $argName                   # delete all',
        '',
        '{{options}}',
        'Where "ROLE" is a role tag name (see `triton rbac roles`) and',
        '$argName is $helpArgIs.'
        /* END JSSTYLED */
    ].join('\n');
    ['resourceType', 'cmdName', 'argName', 'helpArgIs'].forEach(function (key) {
        func.help = func.help.replace(new RegExp('\\$' + key, 'g'), cfg[key]);
    });

    return func;
}


var do_role_tags = makeRoleTagsFunc({
    resourceType: 'resource',
    funcName: 'do_role_tags',
    cmdName: 'role-tags',
    argName: 'RESOURCE-URL',
    helpArgIs: 'an RBAC resource URL'
});

var do_instance_role_tags = makeRoleTagsFunc({
    resourceType: 'instance',
    funcName: 'do_instance_role_tags',
    cmdName: 'instance-role-tags',
    argName: 'INST',
    helpArgIs: 'an instance "id", "name" or short id'
});

var do_image_role_tags = makeRoleTagsFunc({
    resourceType: 'image',
    funcName: 'do_image_role_tags',
    cmdName: 'image-role-tags',
    argName: 'IMG',
    helpArgIs: 'an image "id", "name" or short id'
});

var do_network_role_tags = makeRoleTagsFunc({
    resourceType: 'network',
    funcName: 'do_network_role_tags',
    cmdName: 'network-role-tags',
    argName: 'NETWORK',
    helpArgIs: 'a network "id", "name" or short id'
});

var do_package_role_tags = makeRoleTagsFunc({
    resourceType: 'package',
    funcName: 'do_package_role_tags',
    cmdName: 'package-role-tags',
    argName: 'PKG',
    helpArgIs: 'a package "id", "name" or short id'
});




module.exports = {
    do_role_tags: do_role_tags,
    do_instance_role_tags: do_instance_role_tags,
    do_image_role_tags: do_image_role_tags,
    do_network_role_tags: do_network_role_tags,
    do_package_role_tags: do_package_role_tags
};
