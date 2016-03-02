/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton fwrule ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function FirewallRuleCLI(top) {
    this.top = top;

    Cmdln.call(this, {
        name: top.name + ' fwrule',
        desc: 'List and manage Triton firewall rules.',
        helpSubcmds: [
            'help',
            'list',
            'get',
            'create',
            'update',
            'delete',
            { group: '' },
            'enable',
            'disable',
            'instances'
        ],
        helpOpts: {
            minHelpCol: 23
        }
    });
}
util.inherits(FirewallRuleCLI, Cmdln);

FirewallRuleCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

FirewallRuleCLI.prototype.do_list = require('./do_list');
FirewallRuleCLI.prototype.do_create = require('./do_create');
FirewallRuleCLI.prototype.do_get = require('./do_get');
FirewallRuleCLI.prototype.do_update = require('./do_update');
FirewallRuleCLI.prototype.do_delete = require('./do_delete');
FirewallRuleCLI.prototype.do_enable = require('./do_enable');
FirewallRuleCLI.prototype.do_disable = require('./do_disable');
FirewallRuleCLI.prototype.do_instances = require('./do_instances');

module.exports = FirewallRuleCLI;
