/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton package ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function PackageCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' package',
        /* BEGIN JSSTYLED */
        desc: [
            'List and get Triton packages.',
            '',
            'A package is a collection of attributes -- for example disk quota,',
            'amount of RAM -- used when creating an instance. They have a name',
            'and ID for identification.'
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
util.inherits(PackageCLI, Cmdln);

PackageCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

PackageCLI.prototype.do_list = require('./do_list');
PackageCLI.prototype.do_get = require('./do_get');


PackageCLI.aliases = ['pkg'];

module.exports = PackageCLI;
