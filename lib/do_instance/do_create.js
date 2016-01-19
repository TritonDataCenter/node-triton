/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton instance create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');
var mat = require('../metadataandtags');


function do_create(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        return cb(new errors.UsageError('incorrect number of args'));
    }

    var log = this.top.log;
    var cloudapi = this.top.tritonapi.cloudapi;

    vasync.pipeline({arg: {}, funcs: [
        function loadMetadata(ctx, next) {
            mat.metadataFromOpts(opts, log, function (err, metadata) {
                if (err) {
                    next(err);
                    return;
                }
                if (metadata) {
                    log.trace({metadata: metadata},
                        'metadata loaded from opts');
                    ctx.metadata = metadata;
                }
                next();
            });
        },
        function loadTags(ctx, next) {
            mat.tagsFromOpts(opts, log, function (err, tags) {
                if (err) {
                    next(err);
                    return;
                }
                if (tags) {
                    log.trace({tags: tags}, 'tags loaded from opts');
                    ctx.tags = tags;
                }
                next();
            });
        },
        function getImg(ctx, next) {
            var _opts = {
                name: args[0],
                useCache: true
            };
            self.top.tritonapi.getImage(_opts, function (err, img) {
                if (err) {
                    return next(err);
                }
                ctx.img = img;
                log.trace({img: img}, 'create-instance img');
                next();
            });
        },
        function getPkg(ctx, next) {
            if (args.length < 2) {
                return next();
            }

            var id = args[1];
            if (common.isUUID(id)) {
                ctx.pkg = {id: id};
                next();
                return;
            }

            self.top.tritonapi.getPackage(id, function (err, pkg) {
                if (err) {
                    return next(err);
                }
                log.trace({pkg: pkg}, 'create-instance pkg');
                ctx.pkg = pkg;
                next();
            });
        },
        function getNets(ctx, next) {
            if (!opts.network) {
                return next();
            }
            // TODO: want an error or warning on no networks?
            ctx.nets = [];
            vasync.forEachPipeline({
                inputs: opts.network,
                func: function getOneNetwork(name, nextNet) {
                    self.top.tritonapi.getNetwork(name, function (err, net) {
                        if (err) {
                            nextNet(err);
                        } else {
                            ctx.nets.push(net);
                            nextNet();
                        }
                    });
                }
            }, next);
        },
        function createInst(ctx, next) {
            var createOpts = {
                name: opts.name,
                image: ctx.img.id,
                'package': ctx.pkg && ctx.pkg.id,
                networks: ctx.nets && ctx.nets.map(
                    function (net) { return net.id; })
            };
            if (ctx.metadata) {
                Object.keys(ctx.metadata).forEach(function (key) {
                    createOpts['metadata.'+key] = ctx.metadata[key];
                });
            }
            if (ctx.tags) {
                Object.keys(ctx.tags).forEach(function (key) {
                    createOpts['tag.'+key] = ctx.tags[key];
                });
            }

            for (var i = 0; i < opts._order.length; i++) {
                var opt = opts._order[i];
                if (opt.key === 'firewall') {
                    createOpts.firewall_enabled = opt.value;
                }
            }

            log.trace({dryRun: opts.dry_run, createOpts: createOpts},
                'create-instance createOpts');
            ctx.start = Date.now();
            if (opts.dry_run) {
                ctx.inst = {
                    id: 'beefbeef-4c0e-11e5-86cd-a7fd38d2a50b',
                    name: 'this-is-a-dry-run'
                };
                console.log('Creating instance %s (%s, %s@%s)',
                    ctx.inst.name, ctx.inst.id,
                    ctx.img.name, ctx.img.version);
                return next();
            }

            cloudapi.createMachine(createOpts, function (err, inst) {
                if (err) {
                    next(new errors.TritonError(err,
                        'error creating instance'));
                    return;
                }
                ctx.inst = inst;
                if (opts.json) {
                    console.log(JSON.stringify(inst));
                } else {
                    console.log('Creating instance %s (%s, %s@%s%s)',
                        inst.name, inst.id, ctx.img.name, ctx.img.version,
                        inst.package ? format(', %s', inst.package) : '');
                }
                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                return next();
            }

            //  1 'wait': no distraction.
            // >1 'wait': distraction, pass in the N.
            var distraction;
            if (process.stderr.isTTY && opts.wait.length > 1) {
                distraction = distractions.createDistraction(opts.wait.length);
            }

            // Dry-run: fake wait for a few seconds.
            var waiter = (opts.dry_run ?
                function dryWait(waitOpts, waitCb) {
                    setTimeout(function () {
                        ctx.inst.state = 'running';
                        waitCb(null, ctx.inst);
                    }, 5000);
                }
                : cloudapi.waitForMachineStates.bind(cloudapi));

            waiter({
                id: ctx.inst.id,
                states: ['running', 'failed']
            }, function (err, inst) {
                if (distraction) {
                    distraction.destroy();
                }
                if (err) {
                    return next(err);
                }
                if (opts.json) {
                    console.log(JSON.stringify(inst));
                } else if (inst.state === 'running') {
                    var dur = Date.now() - ctx.start;
                    console.log('Created instance %s (%s) in %s',
                        inst.name, inst.id, common.humanDurationFromMs(dur));
                }
                if (inst.state !== 'running') {
                    next(new Error(format('failed to create instance %s (%s)',
                        inst.name, inst.id)));
                } else {
                    next();
                }
            });
        }
    ]}, function (err) {
        cb(err);
    });
}

do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        group: 'Create options'
    },
    {
        names: ['name', 'n'],
        helpArg: 'NAME',
        type: 'string',
        help: 'Instance name. If not given, one will be generated server-side.'
    },
    {
        // TODO: add boolNegationPrefix:'no-' when that cmdln pull is in
        names: ['firewall'],
        type: 'bool',
        help: 'Enable Cloud Firewall on this instance. See ' +
            '<https://docs.joyent.com/public-cloud/network/firewall>'
    },
    {
        names: ['metadata', 'm'],
        type: 'arrayOfString',
        helpArg: 'DATA',
        help: 'Add metadata when creating the instance. Metadata are ' +
            'key/value pairs available on the instance API object as the ' +
            '"metadata" field, and inside the instance via the "mdata-*" ' +
            'commands. DATA is one of: a "key=value" string (bool and ' +
            'numeric "value" are converted to that type), a JSON object ' +
            '(if first char is "{"), or a "@FILE" to have metadata be ' +
            'loaded from FILE. This option can be used multiple times.'
    },
    {
        names: ['metadata-file', 'M'],
        type: 'arrayOfString',
        helpArg: 'KEY=FILE',
        help: 'Set a metadata key KEY from the contents of FILE.'
    },
    {
        names: ['script'],
        type: 'arrayOfString',
        helpArg: 'FILE',
        help: 'Load a file to be used for the "user-script" metadata key. In ' +
            'Joyent-provided images, the user-script is run at every boot ' +
            'of the instance. This is a shortcut for `-M user-script=FILE`.'
    },
    {
        names: ['tag', 't'],
        type: 'arrayOfString',
        helpArg: 'TAG',
        help: 'Add a tag when creating the instance. Tags are ' +
            'key/value pairs available on the instance API object as the ' +
            '"tags" field. TAG is one of: a "key=value" string (bool and ' +
            'numeric "value" are converted to that type), a JSON object ' +
            '(if first char is "{"), or a "@FILE" to have tags be ' +
            'loaded from FILE. This option can be used multiple times.'
    },
    {
        names: ['network', 'N'],
        type: 'arrayOfCommaSepString',
        helpArg: 'NETWORK',
        help: 'One or more comma-separated networks (ID, name or short id). ' +
            'This option can be used multiple times.'
    },

    // XXX locality: near, far

    {
        group: 'Other options'
    },
    {
        names: ['dry-run'],
        type: 'bool',
        help: 'Go through the motions without actually creating.'
    },
    {
        names: ['wait', 'w'],
        type: 'arrayOfBool',
        help: 'Wait for the creation to complete. Use multiple times for a ' +
            'spinner.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    }
];

do_create.help = (
    /* BEGIN JSSTYLED */
    'Create a new instance.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} create [<options>] IMAGE PACKAGE\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);

do_create.helpOpts = {
    maxHelpCol: 18
};


module.exports = do_create;
