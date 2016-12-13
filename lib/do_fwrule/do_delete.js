/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton snapshot delete ...`
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

    if (args.length < 1) {
        cb(new errors.UsageError('missing FWRULE argument(s)'));
        return;
    }

    var tritonapi = this.top.tritonapi;
    var ruleIds = args;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function confirm(_, next) {
            if (opts.force) {
                return next();
            }

            var msg;
            if (ruleIds.length === 1) {
                msg = 'Delete firewall rule "' + ruleIds[0] + '"? [y/n] ';
            } else {
                msg = format('Delete %d firewall rules (%s)? [y/n] ',
                    ruleIds.length, ruleIds.join(', '));
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
            vasync.forEachParallel({
                inputs: ruleIds,
                func: function deleteOne(id, nextId) {
                    tritonapi.deleteFirewallRule({
                        id: id
                    }, function (err) {
                        if (err) {
                            nextId(err);
                            return;
                        }

                        console.log('Deleted rule %s', id);
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
        help: 'Skip confirmation of delete.'
    }
];

do_delete.synopses = ['{{name}} {{cmd}} FWRULE [FWRULE ...]'];

do_delete.help = [
    'Remove a firewall rule.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where FWRULE is a firewall rule id (full UUID) or short id.'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritonfwrule'];

module.exports = do_delete;
