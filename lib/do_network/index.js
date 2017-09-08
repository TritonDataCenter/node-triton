/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton network ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function NetworkCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' network',
        /* BEGIN JSSTYLED */
        desc: [
            'List and manage Triton networks.'
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
            'get-default',
            'set-default'
        ]
    });
}
util.inherits(NetworkCLI, Cmdln);

NetworkCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

NetworkCLI.prototype.do_list = require('./do_list');
NetworkCLI.prototype.do_get = require('./do_get');
NetworkCLI.prototype.do_create = require('./do_create');
NetworkCLI.prototype.do_delete = require('./do_delete');
NetworkCLI.prototype.do_get_default = require('./do_get_default');
NetworkCLI.prototype.do_set_default = require('./do_set_default');


module.exports = NetworkCLI;
