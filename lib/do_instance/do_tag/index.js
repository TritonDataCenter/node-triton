/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance tag ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');


// ---- CLI class

function InstanceTagCLI(parent) {
    this.top = parent.top;
    Cmdln.call(this, {
        name: parent.name + ' tag',
        /* BEGIN JSSTYLED */
        desc: [
            'List, get, set and delete tags on Triton instances.'
        ].join('\n'),
        /* END JSSTYLED */
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'list',
            'get',
            'set',
            'replace-all',
            'delete'
        ]
    });
}
util.inherits(InstanceTagCLI, Cmdln);

InstanceTagCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

InstanceTagCLI.prototype.do_list = require('./do_list');
InstanceTagCLI.prototype.do_get = require('./do_get');
InstanceTagCLI.prototype.do_set = require('./do_set');
InstanceTagCLI.prototype.do_replace_all = require('./do_replace_all');
InstanceTagCLI.prototype.do_delete = require('./do_delete');

module.exports = InstanceTagCLI;
