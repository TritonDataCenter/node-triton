/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton datacenter ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');

// ---- CLI class

function DatacenterCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' datacenter',
        /* BEGIN JSSTYLED */
        desc: [
            'List and get Triton datacenters.',
            '',
            'A "cloud" is a set of related datacenters that share account',
            'information.'
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
util.inherits(DatacenterCLI, Cmdln);

DatacenterCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

DatacenterCLI.prototype.do_list = require('./do_list');
DatacenterCLI.prototype.do_get = require('./do_get');

module.exports = DatacenterCLI;
