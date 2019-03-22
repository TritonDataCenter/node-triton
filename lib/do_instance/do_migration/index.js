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

/*
 * PENDING: Complete as we advance with VMAPI/CloudAPI implementation:
 * - "estimate" is already implemented in CloudAPI, but information from
 *   VMAPI is far from being complete. Should wait for cmdln implementation
 *   until it's done.
 * - "automatic/full" is not yet supported by VMAPI. Should wait until it's
 *   before proceeding with cmdln. Ditto for "abort" and "schedule".
 *   Implementation details are: "automatic" and "schedule" are pretty much
 *   like "begin" and "abort" is exactly like "pause"
 * - "watch" implementation should wait until "sdc-migrate" tool is complete
 *   in order to take advantage of that and have something closer to an unified
 *   interface. Once it's implemented we can change tests from multiple listing
 *   to use watch.
 */

// ---- CLI class

function MigrationCLI(top) {
    this.top = top.top;

    Cmdln.call(this, {
        name: top.name + ' instance migration',
        desc: 'List, begin, sync and switch to Triton instance migrations.',
        helpSubcmds: [
            'help',
            'begin',
            'sync',
            'switch',
            'pause',
            'abort',
            'list',
            'estimate',
            'automatic'
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
MigrationCLI.prototype.do_estimate = require('./do_estimate');
MigrationCLI.prototype.do_automatic = require('./do_automatic');
module.exports = MigrationCLI;
