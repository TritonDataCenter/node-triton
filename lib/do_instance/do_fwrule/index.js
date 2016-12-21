/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * `triton instance fwrule ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');


// ---- CLI class

function InstanceFwruleCLI(parent) {
    this.top = parent.top;
    Cmdln.call(this, {
        name: parent.name + ' fwrule',
        desc: [
            'List fwrules on Triton instances.'
        ].join('\n'),
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'list'
        ]
    });
}
util.inherits(InstanceFwruleCLI, Cmdln);

// `triton instance fwrules` came first, so we'll hide this one.
InstanceFwruleCLI.hidden = true;

InstanceFwruleCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

InstanceFwruleCLI.prototype.do_list = require('./do_list');

module.exports = InstanceFwruleCLI;
