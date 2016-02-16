/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton instance ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');


// ---- CLI class

function InstanceCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' instance',
        /* BEGIN JSSTYLED */
        desc: [
            'List, get, create and manage Triton instances.'
        ].join('\n'),
        /* END JSSTYLED */
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'list',
            'get',
            'create',
            'delete',
            { group: '' },
            'start',
            'stop',
            'reboot',
            { group: '' },
            'ssh',
            'wait',
            'audit',
            'fwrules',
            'snapshot',
            'tag'
        ]
    });
}
util.inherits(InstanceCLI, Cmdln);

InstanceCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

InstanceCLI.prototype.do_list = require('./do_list');
InstanceCLI.prototype.do_get = require('./do_get');
InstanceCLI.prototype.do_create = require('./do_create');
InstanceCLI.prototype.do_delete = require('./do_delete');

InstanceCLI.prototype.do_start = require('./do_start');
InstanceCLI.prototype.do_stop = require('./do_stop');
InstanceCLI.prototype.do_reboot = require('./do_reboot');

InstanceCLI.prototype.do_ssh = require('./do_ssh');
InstanceCLI.prototype.do_wait = require('./do_wait');
InstanceCLI.prototype.do_audit = require('./do_audit');
InstanceCLI.prototype.do_fwrules = require('./do_fwrules');
InstanceCLI.prototype.do_snapshot = require('./do_snapshot');
InstanceCLI.prototype.do_snapshots = require('./do_snapshots');
InstanceCLI.prototype.do_tag = require('./do_tag');
InstanceCLI.prototype.do_tags = require('./do_tags');

InstanceCLI.aliases = ['inst'];

module.exports = InstanceCLI;
