/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 *
 * `triton instance create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../common');
var disks = require('../disks');
var distractions = require('../distractions');
var errors = require('../errors');
var mat = require('../metadataandtags');
var NETWORK_OBJECT_FIELDS =
    require('../constants').NETWORK_OBJECT_FIELDS;

function parseVolMount(volume) {
    var components;
    var volMode;
    var volMountpoint;
    var volName;
    var VALID_MODES = ['ro', 'rw'];
    var VALID_VOLUME_NAME_REGEXP = /^[a-zA-Z0-9][a-zA-Z0-9_\.\-]+$/;

    assert.string(volume, 'volume');

    components = volume.split(':');
    if (components.length !== 2 && components.length !== 3) {
        return new errors.UsageError('invalid volume specified, must be in ' +
            'the form "<volume name>:<mount path>[:<mode>]", got: "' + volume +
            '"');
    }

    volName = components[0];
    volMountpoint = components[1];
    volMode = components[2];

    // first component should be a volume name. We only check here that it
    // syntactically looks like a volume name, we'll leave the upstream to
    // determine if it's not actually a volume.
    if (!VALID_VOLUME_NAME_REGEXP.test(volName)) {
        return new errors.UsageError('invalid volume name, got: "' + volume +
            '"');
    }

    // second component should be an absolute path
    // NOTE: if we ever move past node 0.10, we could use path.isAbsolute(path)
    if (volMountpoint.length === 0 || volMountpoint[0] !== '/') {
        return new errors.UsageError('invalid volume mountpoint, must be ' +
            'absolute path, got: "' + volume + '"');
    }
    if (volMountpoint.indexOf('\0') !== -1) {
        return new errors.UsageError('invalid volume mountpoint, contains ' +
            'invalid characters, got: "' + volume + '"');
    }
    if (volMountpoint.search(/[^\/]/) === -1) {
        return new errors.UsageError('invalid volume mountpoint, must contain' +
            ' at least one non-/ character, got: "' + volume + '"');
    }

    // third component is optional mode: 'ro' or 'rw'
    if (components.length === 3 && VALID_MODES.indexOf(volMode) === -1) {
        return new errors.UsageError('invalid volume mode, got: "' + volume +
            '"');
    }

    return {
        mode: volMode || 'rw',
        mountpoint: volMountpoint,
        name: volName
    };
}

function do_create(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    } else if (opts.nic && opts.network) {
        cb(new errors.UsageError(
            '--network and --nic cannot be specified together'));
        return;
    }

    var log = this.top.log;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,

        /*
         * Make sure if volumes were passed, they're in the correct form.
         */
        function parseVolMounts(ctx, next) {
            var idx;
            var validationErrs = [];
            var parsedObj;
            var volMounts = [];

            if (!opts.volume) {
                next();
                return;
            }

            for (idx = 0; idx < opts.volume.length; idx++) {
                parsedObj = parseVolMount(opts.volume[idx]);
                if (parsedObj instanceof Error) {
                    validationErrs.push(parsedObj);
                } else {
                    // if it's not an error, it's a volume
                    volMounts.push(parsedObj);
                }
            }

            if (validationErrs.length > 0) {
                next(new errors.MultiError(validationErrs));
                return;
            }

            if (volMounts.length > 0) {
                ctx.volMounts = volMounts;
            }

            next();
        },

        /*
         * Parse any disks given via `--disk`
         */
        function parseDisks(ctx, next) {
            if (!opts.disk) {
                next();
                return;
            }
            disks.disksFromArgs(opts.disk, log, function dCb(err, parsedDisks) {
                if (err) {
                    next(err);
                    return;
                }

                if (parsedDisks) {
                    log.trace({disks: parsedDisks},
                        'disks loaded from args');
                    ctx.disks = parsedDisks;
                }
                next();
            });
        },

        /*
         * Parse any nics given via `--nic`
         */
        function parseNics(ctx, next) {
            if (!opts.nic) {
                next();
                return;
            }

            ctx.nics = [];
            var i;
            var networksSeen = {};
            var nic;
            var nics = opts.nic;

            log.trace({nics: nics}, 'parsing nics');

            for (i = 0; i < nics.length; i++) {
                nic = nics[i].split(',');

                try {
                    nic = common.parseNicStr(nic);
                    if (networksSeen[nic.ipv4_uuid]) {
                        throw new errors.UsageError(format(
                            'only 1 ip on a network allowed '
                            + '(network %s specified multiple times)',
                            nic.ipv4_uuid));
                    }
                    networksSeen[nic.ipv4_uuid] = true;
                    ctx.nics.push(nic);
                } catch (err) {
                    next(err);
                    return;
                }
            }

            log.trace({nics: ctx.nics}, 'parsed nics');

            next();
        },

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
            mat.tagsFromCreateOpts(opts, log, function (err, tags) {
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
                excludeInactive: true,
                useCache: true
            };
            tritonapi.getImage(_opts, function (err, img) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.img = img;
                log.trace({img: img}, 'create-instance img');
                next();
            });
        },
        function getPkg(ctx, next) {
            if (args.length < 2) {
                next();
                return;
            }

            var id = args[1];
            if (common.isUUID(id)) {
                ctx.pkg = {id: id};
                next();
                return;
            }

            tritonapi.getPackage(id, function (err, pkg) {
                if (err) {
                    next(err);
                    return;
                }
                log.trace({pkg: pkg}, 'create-instance pkg');
                ctx.pkg = pkg;
                next();
            });
        },
        function getNets(ctx, next) {
            if (!opts.network) {
                next();
                return;
            }
            // TODO: want an error or warning on no networks?
            ctx.nets = [];
            vasync.forEachPipeline({
                inputs: opts.network,
                func: function getOneNetwork(name, nextNet) {
                    tritonapi.getNetwork(name, function (err, net) {
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
            assert.optionalArrayOfObject(ctx.disks, 'ctx.disks');
            assert.optionalArrayOfObject(ctx.volMounts, 'ctx.volMounts');

            var createOpts = {
                brand: opts.brand,
                name: opts.name,
                image: ctx.img.id,
                'package': ctx.pkg && ctx.pkg.id
            };

            if (ctx.nets) {
                createOpts.networks = ctx.nets.map(function (net) {
                    return net.id;
                });
            } else if (ctx.nics) {
                createOpts.networks = ctx.nics;
            }

            if (ctx.volMounts) {
                createOpts.volumes = ctx.volMounts;
            }
            if (ctx.disks) {
                createOpts.disks = ctx.disks;
            }
            if (opts.affinity) {
                createOpts.affinity = opts.affinity;
            }
            if (ctx.metadata) {
                Object.keys(ctx.metadata).forEach(function (key) {
                    createOpts['metadata.' + key] = ctx.metadata[key];
                });
            }
            if (ctx.tags) {
                Object.keys(ctx.tags).forEach(function (key) {
                    createOpts['tag.' + key] = ctx.tags[key];
                });
            }
            if (opts.allow_shared_images) {
                createOpts.allow_shared_images = true;
            }

            if (opts.encrypted) {
                createOpts.encrypted = true;
            }

            for (var i = 0; i < opts._order.length; i++) {
                var opt = opts._order[i];
                if (opt.key === 'firewall') {
                    createOpts.firewall_enabled = opt.value;
                } else if (opt.key === 'deletion_protection') {
                    createOpts.deletion_protection = opt.value;
                } else if (opt.key === 'delegate_dataset') {
                    createOpts.delegate_dataset = true;
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
                next();
                return;
            }

            tritonapi.cloudapi.createMachine(createOpts, function (err, inst) {
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
                next();
                return;
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
                } : tritonapi.cloudapi.waitForMachineStates.bind(
                    tritonapi.cloudapi));

            waiter({
                id: ctx.inst.id,
                states: ['running', 'failed']
            }, function (err, inst) {
                if (distraction) {
                    distraction.destroy();
                }
                if (err) {
                    next(err);
                    return;
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
        names: ['brand', 'b'],
        helpArg: 'BRAND',
        type: 'string',
        help: 'Define the instance type. Can be one of (bhyve or kvm). When ' +
        'not given, a default brand will be chosen for the given image ' +
        'and/or package.'
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
        names: ['affinity', 'a'],
        type: 'arrayOfString',
        helpArg: 'RULE',
        help: 'Affinity rules for selecting a server for this instance. ' +
            'Rules have one of the following forms: `instance==INST` (the ' +
            'new instance must be on the same server as INST), ' +
            '`instance!=INST` (new inst must *not* be on the same server as ' +
            'INST), `instance==~INST` (*attempt* to place on the same server ' +
            'as INST), or `instance!=~INST` (*attempt* to place on a server ' +
            'other than INST\'s). `INST` is an existing instance name or ' +
            'id. Use this option more than once for multiple rules.',
        completionType: 'tritonaffinityrule'
    },

    {
        group: ''
    },
    {
        names: ['network', 'N'],
        type: 'arrayOfCommaSepString',
        helpArg: 'NETWORK',
        help: 'One or more comma-separated networks (ID, name or short id). ' +
            'This option can be used multiple times.',
        completionType: 'tritonnetwork'
    },
    {
        names: ['nic'],
        type: 'arrayOfString',
        helpArg: 'NICOPTS',
        help: 'A network interface object containing comma separated ' +
            'key=value pairs (Network object format). ' +
            'This option can be used multiple times for multiple NICs. ' +
            'Valid keys are: ' + Object.keys(NETWORK_OBJECT_FIELDS).join(', ')
    },
    {
        names: ['delegate-dataset'],
        type: 'bool',
        help: 'Create a Delegated Dataset on this instance. If set a ' +
              'delegated dataset is created, though the instance is ' +
              'prevented from receiving ZFS datasets (zfs recv). Note ' +
              'that Triton CloudAPI instances must have the SAPI config ' +
              'value "experimental_cloudapi_delegate_dataset=true" ' +
              'for create requests using this option to be allowed.'
    },
    {
        // TODO: add boolNegationPrefix:'no-' when that cmdln pull is in
        names: ['firewall'],
        type: 'bool',
        help: 'Enable Cloud Firewall on this instance. See ' +
            '<https://docs.tritondatacenter.com/public-cloud/network/firewall>'
    },
    {
        names: ['deletion-protection'],
        type: 'bool',
        help: 'Enable Deletion Protection on this instance. Such an instance ' +
            'cannot be deleted until the protection is disabled. See ' +
            // JSSTYLED
            '<https://apidocs.tritondatacenter.com/cloudapi/#deletion-protection>'
    },
    {
        names: ['encrypted'],
        type: 'bool',
        help: 'Place this instance into an encrypted Compute Node. The ' +
            'instance information will be encrypted. False by default. See ' +
            // JSSTYLED
            '<https://github.com/TritonDataCenter/rfd/blob/master/rfd/0077/README.adoc#customer-features>'
    },
    {
        names: ['volume', 'v'],
        type: 'arrayOfString',
        help: 'Mount a volume into the instance (non-KVM only). VOLMOUNT is ' +
            '"<volume-name:/mount/point>[:access-mode]" where access mode is ' +
            'one of "ro" for read-only or "rw" for read-write (default). For ' +
            'example: "-v myvolume:/mnt:ro" to mount "myvolume" read-only on ' +
            '/mnt in this instance.',
        helpArg: 'VOLMOUNT'
    },

    {
        group: ''
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
            'Triton-provided images, the user-script is run at every boot ' +
            'of the instance. This is a shortcut for `-M user-script=FILE`.'
    },
    {
        names: ['allow-shared-images'],
        type: 'bool',
        help: 'Allow instance creation to use a shared image.'
    },
    {
        names: ['disk'],
        type: 'arrayOfString',
        helpArg: 'DATA',
        help: 'Configure disks for an instance with flexible disks. DATA is ' +
            'a JSON object or "@FILE" to have disks loaded from FILE. ' +
            '\'--disk=<JSON object>\' can be used more than once to provide ' +
            'the required number of disks. Each JSON disk argument provided ' +
            'should have the format \'{"size": POSITIVE INTEGER}\'. For the ' +
            'first disk (image disk) it is recommended to provide the ' +
            'value \'{}\' which will automatically set the size to the value ' +
            'specified into the image used to create the instance. For the ' +
            'last disk, the value "remaining" is also allowed.'
    },

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

do_create.synopses = ['{{name}} {{cmd}} [OPTIONS] IMAGE PACKAGE'];

do_create.help = [
    /* BEGIN JSSTYLED */
    'Create a new instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where IMAGE is an image name, name@version, id, or short id (from ',
    '`triton image list`) and PACKAGE is a package name, id, or short id',
    '(from `triton package list`).'
    /* END JSSTYLED */
].join('\n');

do_create.helpOpts = {
    maxHelpCol: 16
};

do_create.completionArgtypes = ['tritonimage', 'tritonpackage', 'none'];

module.exports = do_create;
