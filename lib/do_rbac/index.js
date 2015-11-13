/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton rbac ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function RbacCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' rbac',
        /* BEGIN JSSTYLED */
        desc: 'Role-based Access Control (RBAC) commands. *Experimental.*\n' +
              '\n' +
              'See <https://docs.joyent.com/public-cloud/rbac> for a general start.',
        /* END JSSTYLED */
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'info',
            { group: 'RBAC Resources' },
            'users',
            'user',
            'keys',
            'key',
            'policies',
            'policy',
            'roles',
            'role',
            { group: 'Role Tags' },
            'instance-role-tags',
            'role-tags'
        ]
    });
}
util.inherits(RbacCLI, Cmdln);

RbacCLI.hidden = true;

RbacCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

RbacCLI.prototype.do_info = require('./do_info');

RbacCLI.prototype.do_users = require('./do_users');
RbacCLI.prototype.do_user = require('./do_user');
RbacCLI.prototype.do_keys = require('./do_keys');
RbacCLI.prototype.do_key = require('./do_key');
RbacCLI.prototype.do_policies = require('./do_policies');
RbacCLI.prototype.do_policy = require('./do_policy');
RbacCLI.prototype.do_roles = require('./do_roles');
RbacCLI.prototype.do_role = require('./do_role');

var doRoleTags = require('./do_role_tags');
RbacCLI.prototype.do_role_tags = doRoleTags.do_role_tags;
RbacCLI.prototype.do_instance_role_tags = doRoleTags.do_instance_role_tags;

module.exports = RbacCLI;
