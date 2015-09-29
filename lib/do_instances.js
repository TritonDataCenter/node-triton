/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton instances ...`
 */

var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('./common');



// to be passed as query string args to /my/machines
var validFilters = [
    'name',
    'image',
    'state',
    'memory',
    'tombstone',
    'credentials'
];

// columns default without -o
var columnsDefault = 'shortid,name,img,state,primaryIp,ago';

// columns default with -l
var columnsDefaultLong = 'id,name,img,package,state,primaryIp,created';

// sort default with -s
var sortDefault = 'created';

function do_instances(subcmd, opts, args, callback) {
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

    var listOpts;
    try {
        listOpts = common.kvToObj(args, validFilters);
    } catch (e) {
        callback(e);
        return;
    }


    var imgs;
    var insts;

    vasync.parallel({funcs: [
        function getTheImages(next) {
            self.tritonapi.listImages({useCache: true}, function (err, _imgs) {
                if (err) {
                    next(err);
                } else {
                    imgs = _imgs;
                    next();
                }
            });
        },
        function getTheMachines(next) {
            self.tritonapi.cloudapi.listMachines(listOpts,
                    function (err, _insts) {
                if (err) {
                    next(err);
                } else {
                    insts = _insts;
                    next();
                }
            });
        }
    ]}, function (err, results) {
        /*
         * Error handling: vasync.parallel's `err` is always a MultiError. We
         * want to prefer the `getTheMachines` err, e.g. if both get a
         * self-signed cert error.
         */
        if (err) {
            err = results.operations[1].err || err;
            return callback(err);
        }

        // map "uuid" => "image_name"
        var imgmap = {};
        imgs.forEach(function (img) {
            imgmap[img.id] = format('%s@%s', img.name, img.version);
        });

        // Add extra fields for nice output.
        // XXX FWIW, the "extra fields" for images and packages are not added
        //     for `opts.json`. Thoughts? We should be consistent there. --TM
        var now = new Date();
        insts.forEach(function (inst) {
            var created = new Date(inst.created);
            inst.ago = common.longAgo(created, now);
            inst.img = imgmap[inst.image] || inst.image;
            inst.shortid = inst.id.split('-', 1)[0];
        });

        if (opts.json) {
            common.jsonStream(insts);
        } else {
            tabula(insts, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                dottedLookup: true
            });
        }
        callback();
    });
}

do_instances.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_instances.help = (
    'List instances.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} instances [<filters>...]\n'
    + '\n'
    + '{{options}}'
);

do_instances.aliases = ['insts', 'list', 'ls'];

module.exports = do_instances;
