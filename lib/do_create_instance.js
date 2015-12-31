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

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var tabula = require('tabula');
var tilde = require('tilde-expansion');
var vasync = require('vasync');

var common = require('./common');
var distractions = require('./distractions');
var errors = require('./errors');


// ---- loading/parsing metadata (and tags) from relevant options

/*
 * Load and validate metadata from these options:
 *      -m,--metadata DATA
 *      -M,--metadata-file KEY=FILE
 *      --script FILE
 *
 * <https://github.com/joyent/sdc-vmapi/blob/master/docs/index.md#vm-metadata>
 * says values may be string, num or bool.
 */
function metadataFromOpts(opts, log, cb) {
    assert.arrayOfObject(opts._order, 'opts._order');
    assert.object(log, 'log');
    assert.func(cb, 'cb');

    var metadata = {};

    vasync.forEachPipeline({
        inputs: opts._order,
        func: function metadataFromOpt(o, next) {
            log.trace({opt: o}, 'metadataFromOpt');
            if (o.key === 'metadata') {
                if (!o.value) {
                    next(new errors.UsageError(
                        'empty metadata option value'));
                    return;
                } else if (o.value[0] === '{') {
                    _addMetadataFromJsonStr(
                        'metadata', metadata, o.value, null, next);
                } else if (o.value[0] === '@') {
                    _addMetadataFromFile(
                        'metadata', metadata, o.value.slice(1), next);
                } else {
                    _addMetadataFromKvStr(
                        'metadata', metadata, o.value, null, next);
                }
            } else if (o.key === 'metadata_file') {
                _addMetadataFromKfStr(
                    'metadata', metadata, o.value, null, next);
            } else if (o.key === 'script') {
                _addMetadatumFromFile('metadata', metadata,
                    'user-script', o.value, o.value, next);
            } else {
                next();
            }
        }
    }, function (err) {
        if (err) {
            cb(err);
        } else if (Object.keys(metadata).length) {
            cb(null, metadata);
        } else {
            cb();
        }
    });
}


/*
 * Load and validate tags from these options:
 *      -t,--tag DATA
 *
 * <https://github.com/joyent/sdc-vmapi/blob/master/docs/index.md#vm-metadata>
 * says values may be string, num or bool.
 */
function tagsFromOpts(opts, log, cb) {
    assert.arrayOfObject(opts._order, 'opts._order');
    assert.object(log, 'log');
    assert.func(cb, 'cb');

    var tags = {};

    vasync.forEachPipeline({
        inputs: opts._order,
        func: function tagsFromOpt(o, next) {
            log.trace({opt: o}, 'tagsFromOpt');
            if (o.key === 'tag') {
                if (!o.value) {
                    next(new errors.UsageError(
                        'empty tag option value'));
                    return;
                } else if (o.value[0] === '{') {
                    _addMetadataFromJsonStr('tag', tags, o.value, null, next);
                } else if (o.value[0] === '@') {
                    _addMetadataFromFile('tag', tags, o.value.slice(1), next);
                } else {
                    _addMetadataFromKvStr('tag', tags, o.value, null, next);
                }
            } else {
                next();
            }
        }
    }, function (err) {
        if (err) {
            cb(err);
        } else if (Object.keys(tags).length) {
            cb(null, tags);
        } else {
            cb();
        }
    });
}


var allowedTypes = ['string', 'number', 'boolean'];
function _addMetadatum(ilk, metadata, key, value, from, cb) {
    assert.string(ilk, 'ilk');
    assert.object(metadata, 'metadata');
    assert.string(key, 'key');
    assert.optionalString(from, 'from');
    assert.func(cb, 'cb');

    if (allowedTypes.indexOf(typeof (value)) === -1) {
        cb(new errors.UsageError(format(
            'invalid %s value type%s: must be one of %s: %s=%j',
            ilk, (from ? ' (from ' + from + ')' : ''),
            allowedTypes.join(', '), key, value)));
        return;
    }

    if (metadata.hasOwnProperty(key)) {
        var valueStr = value.toString();
        console.error(
            'warning: %s "%s=%s"%s replaces earlier value for "%s"',
            ilk,
            key,
            (valueStr.length > 10
                ? valueStr.slice(0, 7) + '...' : valueStr),
            (from ? ' (from ' + from + ')' : ''),
            key);
    }
    metadata[key] = value;
    cb();
}

function _addMetadataFromObj(ilk, metadata, obj, from, cb) {
    assert.string(ilk, 'ilk');
    assert.object(metadata, 'metadata');
    assert.object(obj, 'obj');
    assert.optionalString(from, 'from');
    assert.func(cb, 'cb');

    vasync.forEachPipeline({
        inputs: Object.keys(obj),
        func: function _oneField(key, next) {
            _addMetadatum(ilk, metadata, key, obj[key], from, next);
        }
    }, cb);
}

function _addMetadataFromJsonStr(ilk, metadata, s, from, cb) {
    assert.string(ilk, 'ilk');
    try {
        var obj = JSON.parse(s);
    } catch (parseErr) {
        cb(new errors.TritonError(parseErr,
            format('%s%s is not valid JSON', ilk,
                (from ? ' (from ' + from + ')' : ''))));
        return;
    }
    _addMetadataFromObj(ilk, metadata, obj, from, cb);
}

function _addMetadataFromFile(ilk, metadata, file, cb) {
    assert.string(ilk, 'ilk');
    tilde(file, function (metaPath) {
        fs.stat(metaPath, function (statErr, stats) {
            if (statErr || !stats.isFile()) {
                cb(new errors.TritonError(format(
                    '"%s" is not an existing file', file)));
                return;
            }
            fs.readFile(metaPath, 'utf8', function (readErr, data) {
                if (readErr) {
                    cb(readErr);
                    return;
                }
                /*
                 * The file is either a JSON object (first non-space
                 * char is '{'), or newline-separated key=value
                 * pairs.
                 */
                var dataTrim = data.trim();
                if (dataTrim.length && dataTrim[0] === '{') {
                    _addMetadataFromJsonStr(ilk, metadata, dataTrim, file, cb);
                } else {
                    var lines = dataTrim.split(/\r?\n/g).filter(
                        function (line) { return line.trim(); });
                    vasync.forEachPipeline({
                        inputs: lines,
                        func: function oneLine(line, next) {
                            _addMetadataFromKvStr(
                                ilk, metadata, line, file, next);
                        }
                    }, cb);
                }
            });
        });
    });
}

function _addMetadataFromKvStr(ilk, metadata, s, from, cb) {
    assert.string(ilk, 'ilk');

    var parts = strsplit(s, '=', 2);
    if (parts.length !== 2) {
        cb(new errors.UsageError(format(
            'invalid KEY=VALUE %s argument: %s', ilk, s)));
        return;
    }
    var value = parts[1];
    var valueTrim = value.trim();
    if (valueTrim === 'true') {
        value = true;
    } else if (valueTrim === 'false') {
        value = false;
    } else {
        var num = Number(value);
        if (!isNaN(num)) {
            value = num;
        }
    }
    _addMetadatum(ilk, metadata, parts[0].trim(), value, from, cb);
}

/*
 * Add metadata from `KEY=FILE` argument.
 * Here "Kf" stands for "key/file".
 */
function _addMetadataFromKfStr(ilk, metadata, s, from, cb) {
    assert.string(ilk, 'ilk');

    var parts = strsplit(s, '=', 2);
    if (parts.length !== 2) {
        cb(new errors.UsageError(format(
            'invalid KEY=FILE %s argument: %s', ilk, s)));
        return;
    }
    var key = parts[0].trim();
    var file = parts[1];

    _addMetadatumFromFile(ilk, metadata, key, file, file, cb);
}

function _addMetadatumFromFile(ilk, metadata, key, file, from, cb) {
    assert.string(ilk, 'ilk');

    tilde(file, function (filePath) {
        fs.stat(filePath, function (statErr, stats) {
            if (statErr || !stats.isFile()) {
                cb(new errors.TritonError(format(
                    '%s path "%s" is not an existing file', ilk, file)));
                return;
            }
            fs.readFile(filePath, 'utf8', function (readErr, content) {
                if (readErr) {
                    cb(readErr);
                    return;
                }
                _addMetadatum(ilk, metadata, key, content, from, cb);
            });
        });
    });
}



// ---- the command

function do_create_instance(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 2) {
        return cb(new errors.UsageError('incorrect number of args'));
    }

    var log = this.tritonapi.log;
    var cloudapi = this.tritonapi.cloudapi;

    vasync.pipeline({arg: {}, funcs: [
        function loadMetadata(ctx, next) {
            metadataFromOpts(opts, self.log, function (err, metadata) {
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
            tagsFromOpts(opts, self.log, function (err, tags) {
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
    // XXX arrayOfCommaSepString dashdash type
    //{
    //    names: ['networks', 'nets'],
    //    type: 'arrayOfCommaSepString',
    //    help: 'One or more (comma-separated) networks IDs.'
    //},
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

do_create_instance.helpOpts = {
    maxHelpCol: 18
};

do_create_instance.aliases = ['create'];



module.exports = do_create_instance;
do_create_instance.metadataFromOpts = metadataFromOpts; // export for testing
do_create_instance.tagsFromOpts = tagsFromOpts; // export for testing
