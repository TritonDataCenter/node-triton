/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance tag get ...`
 */

var common = require('../../common');
var errors = require('../../errors');


function do_get(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        self.top.tritonapi.getInstanceTag({
            id: args[0],
            tag: args[1]
        }, function (err, value) {
            if (err) {
                cb(err);
                return;
            }
            if (opts.json) {
                console.log(JSON.stringify(value));
            } else {
                console.log(value);
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
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];

do_get.synopses = ['{{name}} {{cmd}} INST NAME'];

do_get.help = [
    'Get an instance tag.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id, name, or shortid and NAME is a tag name.'
].join('\n');

// TODO: When have 'tritoninstancetag' completion, add that in.
do_get.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_get;
