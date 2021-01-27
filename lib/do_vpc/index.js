/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton vpc ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class
function VPCCLI(top) {
    this.top = top;

    Cmdln.call(this, {
        name: top.name + ' vpc',
        desc: 'List and manage Triton VPCs.',
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
util.inherits(VPCCLI, Cmdln);

VPCCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

VPCCLI.prototype.do_list = require('./do_list');
VPCCLI.prototype.do_create = require('./do_create');
VPCCLI.prototype.do_get = require('./do_get');
VPCCLI.prototype.do_update = require('./do_update');
VPCCLI.prototype.do_delete = require('./do_delete');
VPCCLI.prototype.do_networks = require('./do_networks');

module.exports = VPCCLI;
