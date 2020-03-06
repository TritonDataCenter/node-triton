/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 *
 * `triton volume list ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var jsprim = require('jsprim');
var tabula = require('tabula');
var VError = require('verror');

var common = require('../common');
var errors = require('../errors');

var validFilters = [
    'name',
    'size',
    'state',
    'owner',
    'type'
];

var MIBS_IN_GIB = 1024;

// columns default without -o
var columnsDefault = 'shortid,name,size,type,state,age';

// columns default with -l
var columnsDefaultLong = 'id,name,size,type,resource,state,created';

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
            filterPredicate = common.jsonPredFromKv(args, validFilters, 'and');
        } catch (e) {
            callback(new VError(e, 'invalid filters'));
            return;
        }
    }

    if (jsprim.deepEqual(filterPredicate, {})) {
        filterPredicate = { ne: ['state', 'failed'] };
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
                        var created;
                        var volume = volumes[i];

                        created = new Date(volume.created);

                        if (volume.filesystem_path !== undefined) {
                            volume.resource = volume.filesystem_path;
                        }

                        volume.shortid = volume.id.split('-', 1)[0];
                        volume.age = common.longAgo(created, now);
                        volume.size = volume.size / MIBS_IN_GIB + 'G';
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
    '{{options}}',
    'Filters:',
    '    FIELD=VALUE        Equality filter. Supported fields: name, type,',
    '                       size, and state',
    '',
    'Fields (most are self explanatory, "*" indicates a field added client-side',
    'for convenience):',
    '    shortid*           A short ID prefix.',
    '    age*               Approximate time since created, e.g. 1y, 2w.',
    '    resource*          A locator usable by clients to make use of the ',
    '                       volume\'s resources',
    ''
    /* END JSSTYLED */
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
