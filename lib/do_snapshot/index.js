/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton snapshot ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function SnapshotCLI(top) {
    this.top = top;

    Cmdln.call(this, {
        name: top.name + ' snapshot',
        desc: 'Machine snapshot commands',
        helpSubcmds: [
            'help',
            { group: 'Key Resources' },
            'create',
            'list',
            'get',
            'delete'
        ],
        helpBody: 'Machines can be rolled back to a snapshot using\n' +
                  '`triton instance start --snapshot=SNAPSHOT-NAME`'
    });
}
util.inherits(SnapshotCLI, Cmdln);

SnapshotCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

SnapshotCLI.prototype.do_create = require('./do_create');
SnapshotCLI.prototype.do_get = require('./do_get');
SnapshotCLI.prototype.do_list = require('./do_list');
SnapshotCLI.prototype.do_delete = require('./do_delete');

module.exports = SnapshotCLI;
