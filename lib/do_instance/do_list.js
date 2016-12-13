/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance list ...`
 */

var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');


/*
 * Filters to be passed as query string args to /my/machines.
 * See <https://apidocs.joyent.com/cloudapi/#ListMachines>.
 */
var validFilters = [
    'type',
    'brand',  // Added in CloudAPI 8.0.0
    'name',
    'image',
    'state',
    'memory',
    'docker'  // Added in CloudAPI 8.0.0
];

// columns default without -o
var columnsDefault = 'shortid,name,img,state,flags,age';

// columns default with -l
var columnsDefaultLong
    = 'id,name,img,brand,package,state,flags,primaryIp,created';

// sort default with -s
var sortDefault = 'created';

function do_list(subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    }
    var log = self.top.log;

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
    if (opts.credentials) {
        listOpts.credentials = true;
    }


    var imgs = [];
    var insts;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }
        vasync.parallel({funcs: [
            function getTheImages(next) {
                self.top.tritonapi.listImages({
                    state: 'all',
                    useCache: true
                }, function (err, _imgs) {
                    if (err) {
                        if (err.statusCode === 403) {
                            /*
                             * This could be a authorization error due
                             * to RBAC on a subuser. We don't want to
                             * fail `triton inst ls` if the subuser
                             * can ListMachines, but not ListImages.
                             */
                            log.debug(
                                err,
                                'authz error listing images for insts info');
                            next();
                        } else {
                            next(err);
                        }
                    } else {
                        imgs = _imgs;
                        next();
                    }
                });
            },
            function getTheMachines(next) {
                self.top.tritonapi.cloudapi.listMachines(
                    listOpts,
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
             * Error handling: vasync.parallel's `err` is always a
             * MultiError. We want to prefer the `getTheMachines` err,
             * e.g. if both get a self-signed cert error.
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
            var now = new Date();
            insts.forEach(function (inst) {
                var created = new Date(inst.created);
                inst.age = common.longAgo(created, now);
                inst.img = imgmap[inst.image] ||
                    common.uuidToShortId(inst.image);
                inst.shortid = inst.id.split('-', 1)[0];
                var flags = [];
                if (inst.docker) flags.push('D');
                if (inst.firewall_enabled) flags.push('F');
                if (inst.brand === 'kvm') flags.push('K');
                inst.flags = flags.length ? flags.join('') : undefined;
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
    });
}

do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['credentials'],
        type: 'bool',
        help: 'Include generated credentials, in the "metadata.credentials" ' +
            'keys, if any. Typically used with "-j", though one can show ' +
            'values with "-o metadata.credentials".'
    }
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] [FILTERS...]'];

do_list.help = [
    /* BEGIN JSSTYLED */
    'List instances.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Filters:',
    '    FIELD=VALUE        Equality filter. Supported fields: type, brand, name,',
    '                       image, state, and memory',
    '    FIELD=true|false   Boolean filter. Supported fields: docker (added in',
    '                       CloudAPI 8.0.0)',
    '',
    'Fields (most are self explanatory, "*" indicates a field added client-side',
    'for convenience):',
    '    shortid*           A short ID prefix.',
    '    flags*             Single letter flags summarizing some fields:',
    '                           "D" docker instance',
    '                           "F" firewall is enabled',
    '                           "K" the brand is "kvm"',
    '    age*               Approximate time since created, e.g. 1y, 2w.',
    '    img*               The image "name@version", if available, else its',
    '                       "shortid".'
    /* END JSSTYLED */
].join('\n');

do_list.aliases = ['ls'];

module.exports = do_list;
