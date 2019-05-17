/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disk get ...`
 */

var assert = require('assert-plus');

var common = require('../../common');
var errors = require('../../errors');

function do_get(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        cb(new errors.UsageError('missing INST and/or DISKID arguments'));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var instanceId = args[0];
    var diskId = args[1];
    var cli = this.top;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }
        cli.tritonapi.getInstanceDisk({
            id: instanceId,
            diskId: diskId
        }, function onDisk(err, disk) {
            if (err) {
                cb(err);
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(disk));
            } else {
                console.log(JSON.stringify(disk, null, 4));
            }

            cb();
        });
    });
}

do_get.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] INST DISK_UUID'];

do_get.help = [
    'Show a specific disk of an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_get.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_get;
