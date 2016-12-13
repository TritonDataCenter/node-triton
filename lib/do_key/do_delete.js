/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton key delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var sshpk = require('sshpk');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_delete(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing KEY argument(s)'));
        return;
    }

    var cli = this.top;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function confirm(_, next) {
            if (opts.yes) {
                return next();
            }

            var msg;
            if (args.length === 1) {
                msg = 'Delete key "' + args[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d keys (%s)? [y/n] ',
                    args.length, args.join(', '));
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
                inputs: args,
                func: function deleteOne(id, nextId) {
                    var delOpts = {
                        fingerprint: id
                    };

                    cli.tritonapi.cloudapi.deleteKey(delOpts, function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }

                        console.log('Deleted key "%s"', id);
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


do_delete.options = [
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
    }
];

do_delete.synopses = ['{{name}} {{cmd}} [OPTIONS] KEY [KEY ...]'];

do_delete.help = [
    'Remove an SSH key from an account.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "KEY" is an SSH key "name" or "fingerprint".'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritonkey'];

module.exports = do_delete;
