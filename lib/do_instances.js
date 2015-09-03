/*
 * Copyright 2015 Joyent Inc.
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

function do_instances(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }

    var columns = 'shortid,name,img,state,primaryIp,ago'.split(',');
    if (opts.o) {
        /* JSSTYLED */
        columns = opts.o.trim().split(/\s*,\s*/g);
    } else if (opts.long) {
        columns = 'id,name,img,package,state,primaryIp,created'.split(',');
    }
    /* JSSTYLED */
    var sort = (opts.s || 'created').trim().split(/\s*,\s*/g);

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
    this.triton.listImages({useCache: true}, function (err, _images) {
        if (err) {
            callback(err);
            return;
        }
        images = _images;
        done();
    });

    i++;
    var machines;
    this.triton.cloudapi.listMachines(listOpts, function (err, _machines) {
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
].concat(common.TABULA_OPTIONS);

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
