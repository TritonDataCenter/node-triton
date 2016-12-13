/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance get ...`
 */

var common = require('../common');

function do_get(subcmd, opts, args, cb) {
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length !== 1) {
        return cb(new Error('invalid args: ' + args));
    }

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        tritonapi.getInstance(args[0], function (err, inst) {
            if (inst) {
                if (opts.json) {
                    console.log(JSON.stringify(inst));
                } else {
                    console.log(JSON.stringify(inst, null, 4));
                }
            }
            cb(err);
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
do_get.synopses = ['{{name}} {{cmd}} [OPTIONS] INST'];
do_get.help = [
    /* BEGIN JSSTYLED */
    'Get an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    '',
    'Where "INST" is an instance name, id, or short id.',
    '',
    'A *deleted* instance may still respond with the instance object. In that',
    'case a the instance will be print *and* an error will be raised.',
    '',
    'Currently this dumps prettified JSON by default. That might change',
    'in the future. Use "-j" to explicitly get JSON output.'
    /* END JSSTYLED */
].join('\n');

do_get.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_get;
