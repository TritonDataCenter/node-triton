/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton account ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function AccountCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' account',
        /* BEGIN JSSTYLED */
        desc: [
            'Get and update your Triton account.'
        ].join('\n'),
        /* END JSSTYLED */
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'get',
            'update'
        ]
    });
}
util.inherits(AccountCLI, Cmdln);

AccountCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

AccountCLI.prototype.do_get = require('./do_get');
AccountCLI.prototype.do_update = require('./do_update');


module.exports = AccountCLI;
