/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton snapshot get ...`
 */

var assert = require('assert-plus');

var common = require('../common');
var errors = require('../errors');


function do_get(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length < 2) {
        var errMsg = 'missing INST and/or SNAPSHOT-NAME arguments';
        cb(new errors.UsageError(errMsg));
        return;
    } else if (args.length > 2) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];
    var name = args[1];
    var cli = this.top;

    cli.tritonapi.cloudapi.getMachineSnapshot({
        id: id,
        name: name
    }, function onSnapshot(err, snapshot) {
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(snapshot));
        } else {
            console.log(JSON.stringify(snapshot, null, 4));
        }

        cb();
    });
}


do_get.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];
do_get.help = [
    'Show a specific snapshot of a machine.',
    '',
    'Usage:',
    '     {{name}} get INST SNAPSHOT-NAME',
    '',
    '{{options}}'
].join('\n');

module.exports = do_get;
