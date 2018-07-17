/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 *
 * `triton network get-default ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


function do_get_default(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length > 0) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var cli = this.top;

    common.cliSetupTritonApi({cli: cli}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        cli.tritonapi.cloudapi.getConfig({}, function getConf(err, conf) {
            if (err) {
                cb(err);
                return;
            }

            var defaultNetwork = conf.default_network;

            if (!defaultNetwork) {
                cb(new Error('account has no default network configured'));
                return;
            }

            cli.handlerFromSubcmd('network').dispatch({
                subcmd: 'get',
                opts: opts,
                args: [defaultNetwork]
            }, cb);
        });
    });
}


do_get_default.options = require('./do_get').options;

do_get_default.synopses = ['{{name}} {{cmd}}'];

do_get_default.help = [
    'Get default network.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

do_get_default.completionArgtypes = ['tritonnetwork'];

module.exports = do_get_default;
