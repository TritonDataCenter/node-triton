/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 *
 * `triton instance enable-deletion-protection ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_enable_deletion_protection(subcmd, opts, args, cb) {
    assert.object(opts, 'opts');
    assert.arrayOfString(args, 'args');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing INST argument(s)'));
        return;
    }

    var cli = this.top;

    function wait(name, id, next) {
        assert.string(name, 'name');
        assert.uuid(id, 'id');
        assert.func(next, 'next');

       cli.tritonapi.cloudapi.waitForDeletionProtectionEnabled({
            id: id,
            state: true
        }, function (err, inst) {
            if (err) {
                next(err);
                return;
            }

            assert.ok(inst.deletion_protection, 'inst ' + id
                + ' deletion_protection not in expected state after '
                + 'waitForDeletionProtectionEnabled');

            console.log('Enabled deletion protection for instance "%s"', name);
            next();
        });
    }

    function enableOne(name, next) {
        assert.string(name, 'name');
        assert.func(next, 'next');

        cli.tritonapi.enableInstanceDeletionProtection({
            id: name
        }, function enableProtectionCb(err, fauxInst) {
            if (err) {
                next(err);
                return;
            }

            console.log('Enabling deletion protection for instance "%s"',
                name);

            if (opts.wait) {
                wait(name, fauxInst.id, next);
            } else {
                next();
            }
        });
    }

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        vasync.forEachParallel({
            inputs: args,
            func: enableOne
       }, function vasyncCb(err) {
            cb(err);
        });
    });
}


do_enable_deletion_protection.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for deletion protection to be enabled.'
    }
];
do_enable_deletion_protection.synopses = [
    '{{name}} enable-deletion-protection [OPTIONS] INST [INST ...]'
];
do_enable_deletion_protection.help = [
    'Enable deletion protection for one or more instances.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');

do_enable_deletion_protection.completionArgtypes = ['tritoninstance'];

module.exports = do_enable_deletion_protection;
