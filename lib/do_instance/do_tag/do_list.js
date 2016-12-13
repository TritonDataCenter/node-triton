/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance tag list ...`
 */

var common = require('../../common');
var errors = require('../../errors');

function do_list(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        self.top.tritonapi.listInstanceTags(
            {id: args[0]}, function (err, tags) {
            if (err) {
                cb(err);
                return;
            }
            if (opts.json) {
                console.log(JSON.stringify(tags));
            } else {
                console.log(JSON.stringify(tags, null, 4));
            }
            cb();
        });
    });
}

do_list.options = [
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

do_list.synopses = ['{{name}} {{cmd}} INST'];

do_list.help = [
    'List instance tags.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id, name, or shortid.',
    '',
    'Note: Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'
].join('\n');

do_list.aliases = ['ls'];

do_list.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_list;
