/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance tag delete ...`
 */

var vasync = require('vasync');

var common = require('../../common');
var errors = require('../../errors');


function do_delete(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('incorrect number of args'));
        return;
    } else if (args.length > 1 && opts.all) {
        cb(new errors.UsageError('cannot specify both tag names and --all'));
        return;
    }
    var waitTimeoutMs = opts.wait_timeout * 1000; /* seconds to ms */

    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
        }
        if (opts.all) {
            self.top.tritonapi.deleteAllInstanceTags({
                id: args[0],
                wait: opts.wait,
                waitTimeout: waitTimeoutMs
            }, function (err) {
                console.log('Deleted all tags on instance %s', args[0]);
                cb(err);
            });
        } else {
            // Uniq'ify the given names.
            var names = {};
            args.slice(1).forEach(function (arg) { names[arg] = true; });
            names = Object.keys(names);

            // TODO: Instead of waiting for each delete, let's delete
            // them all then wait for the set.
            vasync.forEachPipeline({
                inputs: names,
                func: function deleteOne(name, next) {
                    self.top.tritonapi.deleteInstanceTag({
                        id: args[0],
                        tag: name,
                        wait: opts.wait,
                        waitTimeout: waitTimeoutMs
                    }, function (err) {
                        if (!err) {
                            console.log('Deleted tag %s on instance %s',
                                        name, args[0]);
                        }
                        next(err);
                    });
                }
            }, cb);
        }
    });
}

do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['all', 'a'],
        type: 'bool',
        help: 'Remove all tags on this instance.'
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
    }
];

do_delete.synopses = [
    '{{name}} {{cmd}} INST [NAME ...]',
    '{{name}} {{cmd}} --all INST       # delete all tags'
];

do_delete.help = [
    'Delete one or more instance tags.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where INST is an instance id, name, or shortid and NAME is a tag name.',
    '',
    'Changing instance tags is asynchronous. Use "--wait" to not return until',
    'the changes are completed.'
].join('\n');

do_delete.aliases = ['rm'];

do_delete.completionArgtypes = ['tritoninstance', 'none'];

module.exports = do_delete;
