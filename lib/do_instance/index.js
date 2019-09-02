/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
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
            'List and manage Triton instances.'
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
            'resize',
            'rename',
            { group: '' },
            'start',
            'stop',
            'reboot',
            { group: '' },
            'fwrules',
            'enable-firewall',
            'disable-firewall',
            { group: '' },
            'enable-deletion-protection',
            'disable-deletion-protection',
            { group: '' },
            'ssh',
            'ip',
            'wait',
            'audit',
            'nic',
            'snapshot',
            'tag',
            'disk',
            'migration',
            'exec'
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
InstanceCLI.prototype.do_resize = require('./do_resize');
InstanceCLI.prototype.do_rename = require('./do_rename');

InstanceCLI.prototype.do_start = require('./do_start');
InstanceCLI.prototype.do_stop = require('./do_stop');
InstanceCLI.prototype.do_reboot = require('./do_reboot');

InstanceCLI.prototype.do_fwrule = require('./do_fwrule');
InstanceCLI.prototype.do_fwrules = require('./do_fwrules');
InstanceCLI.prototype.do_enable_firewall = require('./do_enable_firewall');
InstanceCLI.prototype.do_disable_firewall = require('./do_disable_firewall');

InstanceCLI.prototype.do_enable_deletion_protection =
    require('./do_enable_deletion_protection');
InstanceCLI.prototype.do_disable_deletion_protection =
    require('./do_disable_deletion_protection');

InstanceCLI.prototype.do_ssh = require('./do_ssh');
InstanceCLI.prototype.do_ip = require('./do_ip');
InstanceCLI.prototype.do_wait = require('./do_wait');
InstanceCLI.prototype.do_audit = require('./do_audit');
InstanceCLI.prototype.do_nic = require('./do_nic');
InstanceCLI.prototype.do_snapshot = require('./do_snapshot');
InstanceCLI.prototype.do_snapshots = require('./do_snapshots');
InstanceCLI.prototype.do_migration = require('./do_migration');
InstanceCLI.prototype.do_tag = require('./do_tag');
InstanceCLI.prototype.do_tags = require('./do_tags');
InstanceCLI.prototype.do_disk = require('./do_disk');
InstanceCLI.prototype.do_disks = require('./do_disks');
InstanceCLI.prototype.do_exec = require('./do_exec');

InstanceCLI.aliases = ['inst'];

module.exports = InstanceCLI;
