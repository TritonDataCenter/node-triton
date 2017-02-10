/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton metadata create ...`
 */

var assert = require('assert-plus');
var format = require('util').format;
var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');
var mat = require('../../metadataandtags');

function do_update(subcmd, opts, args, cb) {
    assert.func(cb, 'cb');

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length < 1) {
        cb(new errors.UsageError('incorrect number of arguments'));
        return;
    }

    var inst = args[0];
    var cli = this.top;
    var log = this.log;

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function gatherMetas(ctx, next) {
            mat.metadatasFromSetArgs(opts, args.slice(1), log,
                function (err, metas) {
                if (err) {
                    next(err);
                    return;
                }
                log.trace({metas: metas || '<none>'},
                    'metadatas loaded from opts and args');
                ctx.metas = metas;
                next();
            });
        },

        function updateMetadata(ctx, next) {
            ctx.start = Date.now();
            cli.tritonapi.updateInstanceMetadata({
                id: inst,
                metas: ctx.metas,
                wait: opts.wait,
                waitTimeout: opts.wait_timeout * 1000
            }, function (err, metadata, res) {
                if (err) {
                    next(err);
                    return;
                }
                if (!opts.quiet) {
                    if (opts.json) {
                        console.log(JSON.stringify(metadata));
                    } else {
                        console.log(JSON.stringify(metadata, null, 4));
                    }
                }
                cb();
            });
        }
    ]}, cb);
}


do_update.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON stream output.'
    },
    {   names: ['file', 'f'],
        type: 'arrayOfString',
        helpArg: 'FILE',
        help: 'Load metadata name/value pairs from the given file path.' +
              'The file contain a JSON object. this option can be used ' +
              'multiple times.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Quieter output. Specifically do not dump the updated set of '
            + 'metadatas on successful completion.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Block until renaming instance is complete.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }
];

do_update.synopses = ['{{name}} {{cmd}} [OPTIONS] INST [KEY=VALUE ...]',
                      '{{name}} {{cmd}} [OPTIONS] INST -f FILE'];

do_update.help = [
    'update one or more an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id, name, or shortid; KEY is a metadata name;',
    'and VALUE is a metadata value (bool and numeric "value" are converted to ',
    'that type).',
    '',
    'Currently this dumps prettified JSON by default. That might change in the',
    'future. Use "-j" to explicitly get JSON output.'

].join('\n');

do_update.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_update;
