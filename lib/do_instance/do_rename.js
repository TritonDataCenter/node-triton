/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var common = require('../common');
var errors = require('../errors');

function do_rename(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1) {
        callback(new errors.UsageError('missing INST arg'));
        return;
    } else if (args.length < 2) {
        callback(new errors.UsageError('missing NEWNAME arg'));
        return;
    }

    var id = args[0];
    var name = args[1];
    console.log('Renaming instance %s to "%s"', id, name);

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
        }

        tritonapi.renameInstance({
            id: id,
            name: name,
            wait: opts.wait,
            waitTimeout: opts.wait_timeout * 1000
        }, function (err) {
            if (err) {
               callback(err);
               return;
            }
            console.log('Renamed instance %s to "%s"', id, name);
            callback();
        });
    });
}


do_rename.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
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


do_rename.synopses = ['{{name}} rename [OPTIONS] INST NEWNAME'];
do_rename.help = [
    'Rename an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id',
    'and "NEWNAME" is an instance name.',
    '',
    'Changing an instance name is asynchronous.',
    'Use "--wait" to not return until',
    'the changes are completed.'
].join('\n');

do_rename.completionArgtypes = ['tritoninstance', 'none'];


module.exports = do_rename;
