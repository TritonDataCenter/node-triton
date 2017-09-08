/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance nic delete ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


function do_delete(subcmd, opts, args, cb) {
    assert.object(opts, 'opts');
    assert.optionalBool(opts.force, 'opts.force');
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and MAC argument(s)'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var inst = args[0];
    var mac  = args[1];
    var cli  = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        confirm({mac: mac, force: opts.force}, function onConfirm(confirmErr) {
            if (confirmErr) {
                cb();
                return;
            }

            cli.tritonapi.removeNic({
                id: inst,
                mac: mac
            }, function onRemove(err) {
                if (err) {
                    cb(err);
                    return;
                }

                console.log('Deleted NIC %s', mac);
                cb();
            });
        });
    });
}


// Request confirmation before deleting, unless --force flag given.
// If user declines, terminate early.
function confirm(opts, cb) {
    if (opts.force) {
        cb();
        return;
    }

    common.promptYesNo({
        msg: 'Delete NIC "' + opts.mac + '"? [y/n] '
    }, function (answer) {
        if (answer !== 'y') {
            console.error('Aborting');
            cb(new Error('Aborted NIC deletion'));
        } else {
            cb();
        }
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
        help: 'Force removal.'
    }
];

do_delete.synopses = ['{{name}} {{cmd}} INST MAC'];

do_delete.help = [
    'Remove a NIC from an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id (full UUID), name, or short id.',
    '',
    'Be aware that removing NICs from an instance will cause that instance to',
    'reboot.'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_delete;
