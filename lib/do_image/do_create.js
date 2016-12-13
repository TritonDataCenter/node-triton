/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton image create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var strsplit = require('strsplit');
var tabula = require('tabula');
var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');
var mat = require('../metadataandtags');


// ---- the command

function do_create(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 3) {
        cb(new errors.UsageError(
            'incorrect number of args: expect 3, got ' + args.length));
        return;
    }

    var log = this.top.log;
    var tritonapi = this.top.tritonapi;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
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
        function loadAcl(ctx, next) {
            if (!opts.acl) {
                next();
                return;
            }
            for (var i = 0; i < opts.acl.length; i++) {
                if (!common.isUUID(opts.acl[i])) {
                    next(new errors.UsageError(format(
                        'invalid --acl: "%s" is not a UUID', opts.acl[i])));
                    return;
                }
            }
            ctx.acl = opts.acl;
            next();
        },
        function getInst(ctx, next) {
            var id = args[0];
            if (common.isUUID(id)) {
                ctx.inst = {id: id};
                next();
                return;
            }

            tritonapi.getInstance(id, function (err, inst) {
                if (err) {
                    next(err);
                    return;
                }
                log.trace({inst: inst}, 'image create: inst');
                ctx.inst = inst;
                next();
            });
        },
        function createImg(ctx, next) {
            var createOpts = {
                machine: ctx.inst.id,
                name: args[1],
                version: args[2],
                description: opts.description,
                homepage: opts.homepage,
                eula: opts.eula,
                acl: ctx.acl,
                tags: ctx.tags
            };

            log.trace({dryRun: opts.dry_run, createOpts: createOpts},
                'image create createOpts');
            ctx.start = Date.now();
            if (opts.dry_run) {
                ctx.inst = {
                    id: 'cafecafe-4c0e-11e5-86cd-a7fd38d2a50b',
                    name: 'this-is-a-dry-run'
                };
                console.log('Creating image %s@%s from instance %s%s',
                    createOpts.name, createOpts.version, ctx.inst.id,
                    (ctx.inst.name ? ' ('+ctx.inst.name+')' : ''));
                next();
                return;
            }

            tritonapi.cloudapi.createImageFromMachine(
                createOpts, function (err, img) {
                    if (err) {
                        next(new errors.TritonError(err,
                                                    'error creating image'));
                        return;
                    }
                    ctx.img = img;
                    if (opts.json) {
                        console.log(JSON.stringify(img));
                    } else {
                        console.log('Creating image %s@%s (%s)',
                                    img.name, img.version, img.id);
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
                        ctx.img.state = 'running';
                        waitCb(null, ctx.img);
                    }, 5000);
                } : tritonapi.cloudapi.waitForImageStates.bind(
                    tritonapi.cloudapi));

            waiter({
                id: ctx.img.id,
                states: ['active', 'failed']
            }, function (err, img) {
                if (distraction) {
                    distraction.destroy();
                }
                if (err) {
                    return next(err);
                }
                if (opts.json) {
                    console.log(JSON.stringify(img));
                } else if (img.state === 'active') {
                    var dur = Date.now() - ctx.start;
                    console.log('Created image %s (%s@%s) in %s',
                        img.id, img.name, img.version,
                        common.humanDurationFromMs(dur));
                }
                if (img.state !== 'active') {
                    next(new Error(format('failed to create image %s (%s@%s)%s',
                        img.id, img.name, img.version,
                        (img.error ? format(': (%s) %s',
                            img.error.code, img.error.message): ''))));
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
        names: ['description', 'd'],
        type: 'string',
        helpArg: 'DESC',
        help: 'A short description of the image.'
    },
    {
        names: ['homepage'],
        type: 'string',
        helpArg: 'URL',
        help: 'A homepage URL for the image.'
    },
    {
        names: ['eula'],
        type: 'string',
        helpArg: 'DESC',
        help: 'A URL for an End User License Agreement (EULA) for the image.'
    },
    {
        names: ['acl'],
        type: 'arrayOfString',
        helpArg: 'ID',
        help: 'Access Control List. The ID of an account to which to give ' +
            'access to this private image. This option can be used multiple ' +
            'times to give access to multiple accounts.'
    },
    {
        names: ['tag', 't'],
        type: 'arrayOfString',
        helpArg: 'TAG',
        help: 'Add a tag when creating the image. Tags are ' +
            'key/value pairs available on the image API object as the ' +
            '"tags" field. TAG is one of: a "key=value" string (bool and ' +
            'numeric "value" are converted to that type), a JSON object ' +
            '(if first char is "{"), or a "@FILE" to have tags be ' +
            'loaded from FILE. This option can be used multiple times.'
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

do_create.synopses = [
    '{{name}} {{cmd}} [OPTIONS] INST IMAGE-NAME IMAGE-VERSION'
];

do_create.help = [
    /* BEGIN JSSTYLED */
    'Create a new instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
    /* END JSSTYLED */
].join('\n');

do_create.helpOpts = {
    maxHelpCol: 20
};

do_create.completionArgtypes = ['tritoninstance', 'file'];

module.exports = do_create;
