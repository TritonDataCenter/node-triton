/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 *
 * `triton inst nic ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function NicCLI(top) {
    this.top = top.top;

    Cmdln.call(this, {
        name: top.name + ' nic',
        desc: 'List and manage instance NICs.',
        helpSubcmds: [
            'help',
            'list',
            'get',
            'create',
            'delete'
        ],
        helpOpts: {
            minHelpCol: 23
        }
    });
}
util.inherits(NicCLI, Cmdln);

NicCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

NicCLI.prototype.do_list = require('./do_list');
NicCLI.prototype.do_create = require('./do_create');
NicCLI.prototype.do_get = require('./do_get');
NicCLI.prototype.do_delete = require('./do_delete');

module.exports = NicCLI;
