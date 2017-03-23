/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton volume list ...`
 */

var format = require('util').format;
var jsprim = require('jsprim');
var tabula = require('tabula');

var common = require('../common');
var errors = require('../errors');

var validFilters = [
    'name',
    'size',
    'state',
    'owner',
    'type'
];

// columns default without -o
var columnsDefault = 'shortid,name,size,type,state,age';

// columns default with -l
var columnsDefaultLong = 'id,name,size,type,state,created';

// sort default with -s
var sortDefault = 'created';

function do_list(subcmd, opts, args, callback) {
    var self = this;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = columnsDefaultLong;
    }
    columns = columns.split(',');

    var sort = opts.s.split(',');

    var filterPredicate;
    var listOpts;

    if (args) {
        try {
            filterPredicate = common.jsonPredFromKv(args, validFilters,
                'and');
        } catch (e) {
            callback(e);
            return;
        }
    }

    if (jsprim.deepEqual(filterPredicate, {})) {
        filterPredicate = {
            and: [
                { ne: ['state', 'deleted']},
                { ne: ['state', 'failed']}
            ]
        };
    }

    if (filterPredicate) {
        listOpts = {
            predicate: JSON.stringify(filterPredicate)
        };
    }

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        self.top.tritonapi.cloudapi.listVolumes(listOpts,
            function onRes(listVolsErr, volumes, res) {
                var now;

                if (listVolsErr) {
                    return callback(listVolsErr);
                }

                if (opts.json) {
                    common.jsonStream(volumes);
                } else {
                    now = new Date();
                    for (var i = 0; i < volumes.length; i++) {
                        var volume = volumes[i];
                        volume.shortid = volume.id.split('-', 1)[0];
                        volume.created = new Date(volume.create_timestamp);
                        volume.age = common.longAgo(volume.created, now);
                    }

                    tabula(volumes, {
                        skipHeader: opts.H,
                        columns: columns,
                        sort: sort
                    });
                }
                callback();
            });
    });
}

do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] [FILTERS]'];

do_list.help = [
    /* BEGIN JSSTYLED */
    'List volumes.',
    ,
    '{{usage}}',
    '',
    '{{options}}'
    /* END JSSTYLED */
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
