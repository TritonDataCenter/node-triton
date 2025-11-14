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
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');

var COLUMNS_DEFAULT = 'accesskeyid,status,created';
var COLUMNS_LONG = 'accesskeyid,status,description,created,updated';

function _getUserAccessKey(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.string(opts.accessKeyId, 'opts.accessKeyId');
    assert.optionalBool(opts.json, 'opts.json');
    assert.optionalBool(opts.long, 'opts.long');
    assert.optionalString(opts.o, 'opts.o');
    assert.func(cb, 'cb');

    var tritonapi = opts.cli.tritonapi;

    common.cliSetupTritonApi({cli: opts.cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        tritonapi.cloudapi.getUserAccessKey({
            userId: opts.userId,
            accessKeyId: opts.accessKeyId
        }, function onGet(err, accessKey) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(accessKey));
            } else {
                var columns = opts.long ? COLUMNS_LONG : COLUMNS_DEFAULT;
                if (opts.o) {
                    columns = opts.o.toLowerCase();
                }
                columns = columns.split(',');

                tabula([accessKey], {
                    skipHeader: opts.H,
                    columns: columns
                });
            }

            cb();
        });
    });
}

function _deleteUserAccessKey(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.arrayOfString(opts.accessKeyIds, 'opts.accessKeyIds');
    assert.optionalBool(opts.yes, 'opts.yes');
    assert.func(cb, 'cb');
    var tritonapi = opts.cli.tritonapi;

    vasync.pipeline({arg: {cli: opts.cli}, funcs: [
        common.cliSetupTritonApi,
        function confirm(_, next) {
            if (opts.force) {
                next();
                return;
            }

            var msg;
            if (opts.accessKeyIds.length === 1) {
                msg = format('Delete access key "%s"? [y/n] ',
                    opts.accessKeyIds[0]);
            } else {
                msg = format('Delete %d access keys (%s)? [y/n] ',
                    opts.accessKeyIds.length, opts.accessKeyIds.join(', '));
            }

            common.promptYesNo({msg: msg}, function (answer) {
                if (answer !== 'y') {
                    console.error('Aborting');
                    next(true);
                } else {
                    next();
                }
            });
        },
        function deleteKeys(_, next) {
            vasync.forEachPipeline({
                inputs: opts.accessKeyIds,
                func: function deleteOne(accessKeyId, nextId) {
                    tritonapi.cloudapi.deleteUserAccessKey({
                        userId: opts.userId,
                        accessKeyId: accessKeyId
                    }, function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }
                        console.log('Deleted access key "%s"', accessKeyId);
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

function _createUserAccessKey(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.optionalString(opts.status, 'opts.status');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalBool(opts.json, 'opts.json');
    assert.func(cb, 'cb');

    var tritonapi = opts.cli.tritonapi;

    var params = {
        userId: opts.userId
    };

    if (opts.status) {
        params.status = opts.status;
    }

    if (opts.description) {
        params.description = opts.description;
    }

    common.cliSetupTritonApi({cli: opts.cli}, function onSetup(err) {
        if (err) {
            cb(err);
            return;
        }

        tritonapi.cloudapi.createUserAccessKey(params, function onCreate(err2,
            accesskey) {
            if (err2) {
                cb(err2);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(accesskey));
            } else {
                console.log('Created access key %s', accesskey.accesskeyid);
                console.log('Secret: %s', accesskey.accesskeysecret);
            }

            cb();
        });
    });
}

function _updateUserAccessKey(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.userId, 'opts.userId');
    assert.string(opts.accessKeyId, 'opts.accessKeyId');
    assert.optionalString(opts.status, 'opts.status');
    assert.optionalString(opts.description, 'opts.description');
    assert.optionalBool(opts.json, 'opts.json');
    assert.func(cb, 'cb');

    var tritonapi = opts.cli.tritonapi;

    var params = {
        userId: opts.userId,
        accessKeyId: opts.accessKeyId
    };

    if (opts.status) {
        params.status = opts.status;
    }

    if (opts.description) {
        params.description = opts.description;
    }

    common.cliSetupTritonApi({cli: opts.cli}, function onSetup(err) {
        if (err) {
            cb(err);
            return;
        }

        tritonapi.cloudapi.updateUserAccessKey(params, function onCreate(err2,
            accesskey) {
            if (err2) {
                cb(err2);
                return;
            }

            delete params.accessKeyId;
            delete params.userId;
            console.log('Updated access key %s (fields: %s)', opts.accessKeyId,
                        Object.keys(params).join(', '));

            cb();
        });
    });
}

function do_accesskey(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    var actions = [];
    if (opts.create) {
        actions.push('create');
    }

    if (opts['get']) {
        actions.push('get');
    }

    if (opts['update']) {
        actions.push('update');
    }

    if (opts['delete']) {
        actions.push('delete');
    }

    var action;

    if (actions.length === 0) {
        action = 'get';
    } else if (actions.length > 1) {
        return cb(new errors.UsageError(
            'only one action option may be used at once'));
    } else {
        action = actions[0];
    }

    // Arg count validation.
    if (action === 'get') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER and ACCESSKEYID arguments'));
            return;
        } else if (args.length === 1) {
            cb(new errors.UsageError('missing ACCESSKEYID argument'));
            return;
        } else if (args.length > 2) {
            cb(new errors.UsageError('incorrect number of arguments'));
            return;
        }
    } else if (action === 'delete') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER argument'));
            return;
        } else if (args.length === 1) {
            cb(new errors.UsageError('missing ACCESSKEYID argument(s)'));
            return;
        }
    } else if (action === 'create') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER argument'));
            return;
        } else if (args.length > 2) {
            cb(new errors.UsageError('incorrect number of arguments'));
            return;
        }
    } else if (action === 'update') {
        if (args.length === 0) {
            cb(new errors.UsageError('missing USER and ACCESSKEYID arguments'));
            return;
        } else if (args.length === 1) {
            cb(new errors.UsageError('missing ACCESSKEYID argument'));
            return;
        } else if (args.length > 2) {
            cb(new errors.UsageError('incorrect number of arguments'));
        }
    }

    switch (action) {
    case 'get':
        _getUserAccessKey({
            cli: this.top,
            userId: args[0],
            accessKeyId: args[1],
            json: opts.json,
            long: opts.long,
            o: opts.o,
            H: opts.H
        }, cb);
        break;
    case 'delete':
        _deleteUserAccessKey({
            cli: this.top,
            userId: args[0],
            accessKeyIds: args.slice(1),
            force: opts.force
        }, cb);
        break;
    case 'create':
        _createUserAccessKey({
            cli: this.top,
            status: opts.status,
            description: opts.description,
            userId: args[0],
            json: opts.json
        }, cb);
        break;
    case 'update':
        _updateUserAccessKey({
            cli: this.top,
            status: opts.status,
            description: opts.description,
            userId: args[0],
            accessKeyId: args[1],
            json: opts.json
        }, cb);
        break;
    default:
        return cb(new errors.InternalError('unknown action: ' + action));
    }
}

do_accesskey.options = [
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
        names: ['long', 'l'],
        type: 'bool',
        help: 'Long/wider output. Ignored if "-o ..." is used.'
    },
    {
        names: ['o'],
        type: 'string',
        help: 'Specify fields (columns) to output.',
        helpArg: 'field1,...'
    },
    {
        names: ['H'],
        type: 'bool',
        help: 'Omit table header row.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Skip confirmation prompts.'
    },
    {
        names: ['description', 'desc', 'D'],
        type: 'string',
        helpArg: 'DESC',
        help: 'A short description for the access key.'
    },
    {
        names: ['status', 's'],
        type: 'string',
        helpArg: 'STATUS',
        help: 'Status for the access key'
    },
    {
        group: 'Action Options'
    },
    {
        names: ['create', 'c'],
        type: 'bool',
        help: 'Create a new access key.'
    },
    {
        names: ['get', 'g'],
        type: 'bool',
        help: 'Get an access key.'
    },
    {
        names: ['update', 'u'],
        type: 'bool',
        help: 'Update an access key.'
    },
    {
        names: ['delete', 'd'],
        type: 'bool',
        help: 'Delete an access key.'
    }
];

do_accesskey.synopses = [
    '{{name}} {{cmd}} USER ACCESSKEYID',
    '{{name}} {{cmd}} -c|--create [-s STATUS] [-D DESC] USER',
    '{{name}} {{cmd}} -g|--get USER ACCESSKEYID',
    '{{name}} {{cmd}} -u|--update [-s STATUS] [-D DESC] USER ACCESSKEYID',
    '{{name}} {{cmd}} -d|--delete USER [ACCESSKEYID...]'
];

do_accesskey.help = [
    /* BEGIN JSSTYLED */
    'Create, list, and delete RBAC user access keys.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "USER" is a full RBAC user "id", "login" name or a "shortid"'
    /* END JSSTYLED */
].join('\n');

module.exports = do_accesskey;
