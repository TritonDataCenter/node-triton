/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 *
 * `triton instance migration ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');


// ---- CLI class

function MigrationCLI(top) {
    this.top = top.top;

    Cmdln.call(this, {
        name: top.name + ' migration',
        desc: 'List, begin, sync and switch to Triton instance migrations.',
        helpSubcmds: [
            'help',
            'begin',
            'sync',
            'switch',
            'pause',
            'abort',
            'list',
            'automatic',
            'get'
        ]
    });
}
util.inherits(MigrationCLI, Cmdln);

MigrationCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

MigrationCLI.prototype.do_begin = require('./do_begin');
MigrationCLI.prototype.do_sync = require('./do_sync');
MigrationCLI.prototype.do_switch = require('./do_switch');
MigrationCLI.prototype.do_pause = require('./do_pause');
MigrationCLI.prototype.do_abort = require('./do_abort');
MigrationCLI.prototype.do_list = require('./do_list');
MigrationCLI.prototype.do_get = require('./do_get');
MigrationCLI.prototype.do_automatic = require('./do_automatic');
module.exports = MigrationCLI;
