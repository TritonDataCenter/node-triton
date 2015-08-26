/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton create ...`
 */

var bigspinner = require('bigspinner');
var format = require('util').format;
var path = require('path');
var spawn = require('child_process').spawn;
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('./common');
var errors = require('./errors');


function do_create_instance(subcmd, opts, args, callback) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1 || args.length > 2) {
        return callback(new errors.UsageError(format(
            'incorrect number of args (%d): %s', args.length, args.join(' '))));
    }

    var log = this.triton.log;
    var cloudapi = this.triton.cloudapi;
    var cOpts = {};

    vasync.pipeline({arg: {}, funcs: [
        function getImg(ctx, next) {
            // XXX don't get the image object if it is a UUID, waste of time
            self.triton.getImage(args[0], function (err, img) {
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
            // XXX don't get the package object if it is a UUID, waste of time
            self.triton.getPackage(args[1], function (err, pkg) {
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
            self.triton.getNetworks(opts.networks, function (err, nets) {
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
            log.trace({createOpts: createOpts}, 'create-instance createOpts');
            ctx.start = Date.now();
            cloudapi.createMachine(createOpts, function (err, inst) {
                if (err) {
                    return next(err);
                }
                ctx.inst = inst;
                if (opts.json) {
                    console.log(JSON.stringify(inst));
                } else {
                    console.log('Creating instance %s (%s, %s@%s, %s)',
                        inst.name, inst.id, ctx.img.name, ctx.img.version,
                        inst.package);
                }
                next();
            });
        },
        function maybeWait(ctx, next) {
            if (!opts.wait) {
                return next();
            }

            var spinner, child, killed;
            var died = 0;
            if (!opts.quiet && process.stderr.isTTY) {
                /*
                spinner = bigspinner.createSpinner({
                    delay: 250,
                    stream: process.stderr,
                    height: process.stdout.rows - 2,
                    width: process.stdout.columns - 1,
                    hideCursor: true,
                    fontChar: '#'
                });
                */
                var game = path.join(__dirname, '../node_modules/.bin/snake-game');
                function makechild() {
                    var _now = Date.now();
                    child = spawn(game, {stdio: 'inherit'});
                    child.on('close', function (code) {
                        child = null;
                        if (!killed) {
                            var delta = Date.now() - _now;
                            died++;
                            console.error('[snake] survived %s',
                                common.humanDurationFromMs(delta));
                            makechild();
                        } else {
                            var ESC = '\u001b';
                            var CSI = ESC + '[';
                            process.stdout.write(CSI + '?25h');
                        }
                    });
                }
                makechild();
            }

            cloudapi.waitForMachineStates({
                id: ctx.inst.id,
                states: ['running', 'failed']
            }, function (err, inst) {
                if (spinner) {
                    spinner.destroy();
                }
                if (child) {
                    killed = true;
                    child.kill('SIGINT');
                    console.error('[snake] died %d times!', died);
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
};

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
    // XXX arrayOfCommaSepString dashdash type
    //{
    //    names: ['networks', 'nets'],
    //    type: 'arrayOfCommaSepString',
    //    help: 'One or more (comma-separated) networks IDs.'
    //},
    // XXX enable-firewall
    // XXX locality: near, far
    // XXX metadata, metadata-file
    // XXX script (user-script)
    // XXX tag
    {
        group: 'Other options'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the creation to complete.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'No progress spinner while waiting.'
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
    '    {{name}} create-instance [<options>] IMAGE [PACKAGE]\n' +
    '\n' +
    '{{options}}'
    /* END JSSTYLED */
);

do_create_instance.aliases = ['create'];

module.exports = do_create_instance;
