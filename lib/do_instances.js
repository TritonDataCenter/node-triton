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

var f = require('util').format;

var tabula = require('tabula');

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

    var i = 0;

    i++;
    var images;
    this.tritonapi.listImages({useCache: true}, function (err, _images) {
        if (err) {
            callback(err);
            return;
        }
        images = _images;
        done();
    });

    i++;
    var machines;
    this.tritonapi.cloudapi.listMachines(listOpts, function (err, _machines) {
        if (err) {
            callback(err);
            return;
        }
        machines = _machines;
        done();
    });

    function done() {
        if (--i > 0)
            return;

        // map "uuid" => "image_name"
        var imgmap = {};
        images.forEach(function (image) {
            imgmap[image.id] = f('%s@%s', image.name, image.version);
        });

        // Add extra fields for nice output.
        // XXX FWIW, the "extra fields" for images and packages are not added
        //     for `opts.json`. Thoughts? We should be consistent there. --TM
        var now = new Date();
        machines.forEach(function (machine) {
            var created = new Date(machine.created);
            machine.ago = common.longAgo(created, now);
            machine.img = imgmap[machine.image] || machine.image;
            machine.shortid = machine.id.split('-', 1)[0];
        });

        if (opts.json) {
            common.jsonStream(machines);
        } else {
            tabula(machines, {
                skipHeader: opts.H,
                columns: columns,
                sort: sort,
                dottedLookup: true
            });
        }
        callback();
    }
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

do_instances.aliases = ['insts'];

module.exports = do_instances;
