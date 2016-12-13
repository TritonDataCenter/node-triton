/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance tag replace-all ...`
 */

var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');
var mat = require('../../metadataandtags');


function do_replace_all(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    }
    var log = self.log;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function gatherTags(ctx, next) {
            mat.tagsFromSetArgs(opts, args.slice(1), log, function (err, tags) {
                if (err) {
                    next(err);
                    return;
                }
                log.trace({tags: tags || '<none>'},
                    'tags loaded from opts and args');
                ctx.tags = tags;
                next();
            });
        },

        function replaceAway(ctx, next) {
            if (!ctx.tags) {
                next(new errors.UsageError('no tags were provided'));
                return;
            }
            self.top.tritonapi.replaceAllInstanceTags({
                id: args[0],
                tags: ctx.tags,
                wait: opts.wait,
                waitTimeout: opts.wait_timeout * 1000 /* seconds to ms */
            }, function (err, updatedTags) {
                if (err) {
                    cb(err);
                    return;
                }
                if (!opts.quiet) {
                    if (opts.json) {
                        console.log(JSON.stringify(updatedTags));
                    } else {
                        console.log(JSON.stringify(updatedTags, null, 4));
                    }
                }
                cb();
            });
        }
    ]}, cb);
}

do_replace_all.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['file', 'f'],
        type: 'arrayOfString',
        helpArg: 'FILE',
        help: 'Load tag name/value pairs from the given file path. '
            + 'The file may contain a JSON object or a file with "NAME=VALUE" '
            + 'pairs, one per line. This option can be used multiple times.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Wait for the tag changes to be applied.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Quieter output. Specifically do not dump the updated set of '
            + 'tags on successful completion.'
    }
];

do_replace_all.synopses = [
    '{{name}} {{cmd}} INST [NAME=VALUE ...]',
    '{{name}} {{cmd}} INST -f FILE          # tags from file'
];

do_replace_all.help = [
    'Replace all tags on the given instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id, name, or shortid; NAME is a tag name;',
    'and VALUE is a tag value (bool and numeric "value" are converted to ',
    'that type).',
    '',
    'Currently this dumps prettified JSON by default. That might change in the',
    'future. Use "-j" to explicitly get JSON output.',
    '',
    'Changing instance tags is asynchronous. Use "--wait" to not return until',
    'the changes are completed.'
].join('\n');

do_replace_all.completionArgtypes = ['tritoninstance', 'file'];

module.exports = do_replace_all;
