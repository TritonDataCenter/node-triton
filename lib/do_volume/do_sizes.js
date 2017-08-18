/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton volume sizes ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var jsprim = require('jsprim');
var tabula = require('tabula');
var VError = require('verror');

var common = require('../common');
var errors = require('../errors');

var COLUMNS = ['type', {name: 'SIZE', lookup: 'sizeHuman', align: 'right'}];
var MIBS_IN_GIB = 1024;

// sort default with -s
var sortDefault = 'size';

function do_sizes(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var sort = opts.s.split(',');

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }

        self.top.tritonapi.cloudapi.listVolumeSizes(
            function onRes(listVolSizesErr, volumeSizes, res) {
                if (listVolSizesErr) {
                    return callback(listVolSizesErr);
                }

                if (opts.json) {
                    common.jsonStream(volumeSizes);
                } else {
                    volumeSizes =
                        volumeSizes.map(function renderVolSize(volumeSize) {
                            volumeSize.sizeHuman =
                                volumeSize.size / MIBS_IN_GIB + 'G';
                            return volumeSize;
                        });

                    tabula(volumeSizes, {
                        skipHeader: opts.H,
                        columns: COLUMNS,
                        sort: sort
                    });
                }
                callback();
            });
    });
}

do_sizes.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    sortDefault: sortDefault
}));

do_sizes.synopses = ['{{name}} {{cmd}} [OPTIONS]'];

do_sizes.help = [
    'List volume sizes.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_sizes;
