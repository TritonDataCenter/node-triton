/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
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
        cb(new errors.UsageError('missing ACCESSKEYID argument(s)'));
        return;
    }

    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function confirm(_, next) {
            if (opts.force) {
                next();
                return;
            }

            var msg;
            if (args.length === 1) {
                msg = format('Delete access key "%s"? [y/n] ', args[0]);
            } else {
                msg = format('Delete %d access keys (%s)? [y/n] ',
                    args.length, args.join(', '));
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
                inputs: args,
                func: function deleteOne(accessKeyId, nextId) {
                    tritonapi.cloudapi.deleteAccessKey({
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


do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Skip confirmation prompts.'
    }
];

do_delete.synopses = [
    '{{name}} {{cmd}} [OPTIONS] ACCESSKEYID [ACCESSKEYID...]'
];

do_delete.help = [
    'Delete CloudAPI access keys.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "ACCESSKEYID" is a CloudAPI access key identifier.'
].join('\n');

do_delete.aliases = ['rm'];

module.exports = do_delete;
