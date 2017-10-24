/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton network ip...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function IpCLI(top) {
    this.top = top.top;
    Cmdln.call(this, {
        name: top.name + ' ip',
        /* BEGIN JSSTYLED */
        desc: [
            'List and manage Triton network IPs.'
        ].join('\n'),
        /* END JSSTYLED */
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'list',
            'get'
        ]
    });
}
util.inherits(IpCLI, Cmdln);

IpCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

IpCLI.prototype.do_list = require('./do_list');
IpCLI.prototype.do_get = require('./do_get');

module.exports = IpCLI;
