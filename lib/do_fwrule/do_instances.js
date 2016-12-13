/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton fwrule instances ...`
 */

var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');


var COLUMNS_DEFAULT = 'shortid,name,img,state,flags,age';
var COLUMNS_LONG = 'id,name,img,brand,package,state,flags,primaryIp,created';
var SORT_DEFAULT = 'created';


function do_instances(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (args.length === 0) {
        cb(new errors.UsageError('missing FWRULE argument'));
        return;
    } else if (args.length > 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var id = args[0];

    var columns = COLUMNS_DEFAULT;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = COLUMNS_LONG;
    }
    columns = columns.split(',');

    var sort = opts.s.split(',');

    var imgs;
    var insts;

    var tritonapi = this.top.tritonapi;

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        vasync.parallel({funcs: [
            function getTheImages(next) {
                tritonapi.listImages({
                    useCache: true,
                    state: 'all'
                }, function (err, _imgs) {
                    if (err) {
                        next(err);
                    } else {
                        imgs = _imgs;
                        next();
                    }
                });
            },
            function getTheMachines(next) {
                tritonapi.listFirewallRuleInstances({
                    id: id
                }, function (err, _insts) {
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
                return cb(err);
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

            cb();
        });
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
    sortDefault: SORT_DEFAULT
}));

do_instances.synopses = ['{{name}} {{cmd}} [OPTIONS] FWRULE'];

do_instances.help = [
    /* BEGIN JSSTYLED */
    'List instances to which a firewall rule applies',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where FWRULE is a firewall rule id (full UUID) or short id.',
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

do_instances.aliases = ['insts'];

do_instances.completionArgtypes = ['tritonfwrule', 'none'];

module.exports = do_instances;
