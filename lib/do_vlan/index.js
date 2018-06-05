/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton vlan ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function VlanCLI(top) {
    this.top = top;

    Cmdln.call(this, {
        name: top.name + ' vlan',
        desc: 'List and manage Triton fabric VLANs.',
        helpSubcmds: [
            'help',
            'list',
            'get',
            'create',
            'update',
            'delete',
            { group: '' },
            'networks'
        ],
        helpOpts: {
            minHelpCol: 23
        }
    });
}
util.inherits(VlanCLI, Cmdln);

VlanCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

VlanCLI.prototype.do_list = require('./do_list');
VlanCLI.prototype.do_create = require('./do_create');
VlanCLI.prototype.do_get = require('./do_get');
VlanCLI.prototype.do_update = require('./do_update');
VlanCLI.prototype.do_delete = require('./do_delete');
VlanCLI.prototype.do_networks = require('./do_networks');

module.exports = VlanCLI;
