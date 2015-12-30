/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton image ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function ProfileCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' profile',
        /* BEGIN JSSTYLED */
        desc: [
            'List, get, create and update Triton CLI profiles.',
            '',
            'A profile is a configured Triton CloudAPI endpoint. I.e. the',
            'url, account, key, etc. information required to call a CloudAPI.',
            'You can then switch between profiles with `triton -p PROFILE`',
            'or the TRITON_PROFILE environment variable.'
        ].join('\n'),
        /* END JSSTYLED */
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'list',
            'get',
            'set-current',
            'create',
            'edit',
            'delete'
        ]
    });
}
util.inherits(ProfileCLI, Cmdln);

ProfileCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

ProfileCLI.prototype.do_list = require('./do_list');
ProfileCLI.prototype.do_get = require('./do_get');
ProfileCLI.prototype.do_set_current = require('./do_set_current');
ProfileCLI.prototype.do_create = require('./do_create');
ProfileCLI.prototype.do_delete = require('./do_delete');
ProfileCLI.prototype.do_edit = require('./do_edit');

// TODO: Would like to `triton profile update foo account=trentm ...`
//      And then would like that same key=value syntax optional for create.
//ProfileCLI.prototype.do_update = require('./do_update');

module.exports = ProfileCLI;
