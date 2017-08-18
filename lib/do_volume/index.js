/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton volume ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');

function VolumeCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' volume',
        /* BEGIN JSSTYLED */
        desc: [
            'List and manage Triton volumes.'
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
            'sizes'
        ]
    });
}
util.inherits(VolumeCLI, Cmdln);

VolumeCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

VolumeCLI.prototype.do_list = require('./do_list');
VolumeCLI.prototype.do_get = require('./do_get');
VolumeCLI.prototype.do_create = require('./do_create');
VolumeCLI.prototype.do_delete = require('./do_delete');
VolumeCLI.prototype.do_sizes = require('./do_sizes');

VolumeCLI.aliases = ['vol'];

VolumeCLI.hidden = true;

module.exports = VolumeCLI;
