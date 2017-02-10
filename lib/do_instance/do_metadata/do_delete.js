/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton metadata delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


function do_delete(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (!opts.all && args.length < 2) {
        cb(new errors.UsageError('missing INST and METADATA argument(s)'));
        return;
    }

    var cli = this.top;
    var inst = args[0];
    var names = args.slice(1, args.length);

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function confirm(_, next) {
            if (opts.force) {
                return next();
            }

            var msg;
            if (opts.all) {
                msg = 'Delete All metadata ? [y/n]';
            } else if (names.length === 1) {
                msg = 'Delete metadata "' + names[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d metadatas (%s)? [y/n] ',
                    names.length, names.join(', '));
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

        function deleteThem(ctx, next) {
            if (opts.all) {
                cli.tritonapi.deleteAllInstanceMetadata({
                    id: inst,
                    wait: opts.wait,
                    waitTimeout: opts.wait_timeout * 1000
                }, function (err) {
                    console.log('Deleted all metadatas on instance %s', inst);
                    next(err);
                });

           } else {
                vasync.forEachParallel({
                    inputs: names,
                    func: function deleteOne(name, nextName) {
                        cli.tritonapi.deleteInstanceMetadata({
                            id: inst,
                            key: name,
                            wait: opts.wait,
                            waitTimeout: opts.wait_timeout * 1000
                        }, function (err, res) {
                            if (err) {
                                next(err);
                                return;
                            }
                            var instId = res.instId;
                            var msg = 'Deleted metadata %s of instance "%s"';
                            console.log(msg, name, instId);
                        });
                    }
                }, next);
            }
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
        help: 'Skip confirmation of delete.'
    },
    {
        names: ['all', 'a'],
        type: 'bool',
        help: 'Remove all metadatas on this instance.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Block until renaming instance is complete.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }
];

do_delete.synopses = ['{{name}} {{cmd}} [OPTIONS] INST KEY',
                      '{{name}} {{cmd}} [OPTIONS] --all INST'];

do_delete.help = [
    'Delete one or more instance metadatas.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Where INST is an instance id, name, or shortid and NAME ' +
    'is a metadata name.'

].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_delete;
