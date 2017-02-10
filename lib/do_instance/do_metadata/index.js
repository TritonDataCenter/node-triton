/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton metadata ...`
 */

var Cmdln = require('cmdln').Cmdln;
var util = require('util');



// ---- CLI class

function MetadataCLI(top) {
    this.top = top.top;

    Cmdln.call(this, {
        name: top.name + ' metadata',
        desc: 'List, get, update and delete Triton instance metadatas.',
        helpSubcmds: [
            'help',
            'update',
            'list',
            'get',
            'delete'
        ],
        helpBody: 'Instances can be rolled back to a metadata using\n' +
                  '`triton instance start --metadata=METANAME`.'
    });
}
util.inherits(MetadataCLI, Cmdln);

MetadataCLI.prototype.init = function init(opts, args, cb) {
    this.log = this.top.log;
    Cmdln.prototype.init.apply(this, arguments);
};

MetadataCLI.prototype.do_update = require('./do_update');
MetadataCLI.prototype.do_get = require('./do_get');
MetadataCLI.prototype.do_list = require('./do_list');
MetadataCLI.prototype.do_delete = require('./do_delete');

module.exports = MetadataCLI;
