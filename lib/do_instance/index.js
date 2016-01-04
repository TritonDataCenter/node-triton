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

var gen_do_ACTION = require('./gen_do_ACTION');


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
            'audit'
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
InstanceCLI.prototype.do_delete = gen_do_ACTION(
    {action: 'delete', aliases: ['rm']});

InstanceCLI.prototype.do_start = gen_do_ACTION({action: 'start'});
InstanceCLI.prototype.do_stop = gen_do_ACTION({action: 'stop'});
InstanceCLI.prototype.do_reboot = gen_do_ACTION({action: 'reboot'});

InstanceCLI.prototype.do_ssh = require('./do_ssh');
InstanceCLI.prototype.do_wait = require('./do_wait');
InstanceCLI.prototype.do_audit = require('./do_audit');

InstanceCLI.aliases = ['inst'];

module.exports = InstanceCLI;
