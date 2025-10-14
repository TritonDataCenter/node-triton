/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Edgecast Cloud LLC.
 *
 * `triton accesskeys ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');

var doList = require('./do_list');


// ---- CLI class

function AccessKeysCLI(top) {
    this.top = top;
    Cmdln.call(this, {
        name: top.name + ' accesskeys',
        desc: 'Manage CloudAPI access keys.',
        options: doList.options,
        helpOpts: {
            minHelpCol: 24 /* line up with option help */
        },
        helpSubcmds: [
            'help',
            'get',
            'list',
            'create',
            'delete'
        ]
    });
}
util.inherits(AccessKeysCLI, Cmdln);

AccessKeysCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

/*
 * Handles listing access keys when called with no args
 * e.g. `triton accesskeys` is the same as `triton accesskeys list`
 */
AccessKeysCLI.prototype.emptyLine = function emptyLine(cb) {
    this.dispatch({
        subcmd: 'list',
        opts: this.opts,
        args: []
    }, cb);
};

AccessKeysCLI.prototype.do_list = doList;
AccessKeysCLI.prototype.do_get = require('./do_get');
AccessKeysCLI.prototype.do_create = require('./do_create');
AccessKeysCLI.prototype.do_delete = require('./do_delete');

module.exports = AccessKeysCLI;
