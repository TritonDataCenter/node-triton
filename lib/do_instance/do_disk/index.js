/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance disk ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');

// ---- CLI class

function DiskCLI(top) {
    this.top = top.top;

    Cmdln.call(this, {
        name: top.name + ' disk',
        desc: 'List, get, add, resize and delete Triton instance disks.',
        helpSubcmds: [
            'help',
            'add',
            'list',
            'get',
            'delete',
            'resize'
        ]
    });
}
util.inherits(DiskCLI, Cmdln);

DiskCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

DiskCLI.prototype.do_add = require('./do_add');
DiskCLI.prototype.do_get = require('./do_get');
DiskCLI.prototype.do_list = require('./do_list');
DiskCLI.prototype.do_resize = require('./do_resize');
DiskCLI.prototype.do_delete = require('./do_delete');

module.exports = DiskCLI;
