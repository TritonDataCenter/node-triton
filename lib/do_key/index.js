/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton key ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function KeyCLI(top) {
    this.top = top;

    Cmdln.call(this, {
        name: top.name + ' key',
        desc: 'Account SSH key commands.',
        helpSubcmds: [
            'help',
            { group: 'Key Resources' },
            'add',
            'list',
            'get',
            'delete'
        ]
    });
}
util.inherits(KeyCLI, Cmdln);

KeyCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

KeyCLI.prototype.do_add = require('./do_add');
KeyCLI.prototype.do_get = require('./do_get');
KeyCLI.prototype.do_list = require('./do_list');
KeyCLI.prototype.do_delete = require('./do_delete');

module.exports = KeyCLI;
