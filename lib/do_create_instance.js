/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton create ...`
 */

var format = require('util').format;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('./common');
var distractions = require('./distractions');
var errors = require('./errors');


function do_create_instance(subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 2) {
        return callback(new errors.UsageError('incorrect number of args'));
    }

    var log = this.tritonapi.log;
    var cloudapi = this.tritonapi.cloudapi;

    vasync.pipeline({arg: {}, funcs: [
        function getImg(ctx, next) {
            var _opts = {
                name: args[0],
                useCache: true
            };
            self.tritonapi.getImage(_opts, function (err, img) {
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

            self.tritonapi.getPackage(id, function (err, pkg) {
                if (err) {
                    return next(err);
                }
                log.trace({pkg: pkg}, 'create-instance pkg');
                ctx.pkg = pkg;
                next();
            });
        },
        function getNets(ctx, next) {
            if (!opts.networks) {
                return next();
            }
            self.tritonapi.getNetworks(opts.networks, function (err, nets) {
                if (err) {
                    return next(err);
                }
                ctx.nets = nets;
                next();
            });
        },
        function createInst(ctx, next) {
            var createOpts = {
                name: opts.name,
                image: ctx.img.id,
                'package': ctx.pkg && ctx.pkg.id,
                networks: ctx.nets && ctx.nets.map(
                    function (net) { return net.id; })
            };

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
                    return next(err);
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
        callback(err);
    });
}

do_create_instance.options = [
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
        type: 'string',
        help: 'Instance name. If not given, a random one will be created.'
    },
    {
        // TODO: add boolNegationPrefix:'no-' when that cmdln pull is in
        names: ['firewall'],
        type: 'bool',
        help: 'Enable Cloud Firewall on this instance. See ' +
            '<https://docs.joyent.com/public-cloud/network/firewall>'
    },
    // XXX arrayOfCommaSepString dashdash type
    //{
    //    names: ['networks', 'nets'],
    //    type: 'arrayOfCommaSepString',
    //    help: 'One or more (comma-separated) networks IDs.'
    //},
    // XXX locality: near, far
    // XXX metadata, metadata-file
    // XXX script (user-script)
    // XXX tag
    {
        group: 'Other options'
    },
    {
        names: ['dry-run'],
        type: 'bool',
        help: 'Go through the motions without actually creating an instance.'
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
do_create_instance.help = (
    /* BEGIN JSSTYLED */
    'Create a new instance.\n' +
    '\n' +
    'Usage:\n' +
    '    {{name}} create-instance [<options>] IMAGE PACKAGE\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);

do_create_instance.aliases = ['create'];

module.exports = do_create_instance;
