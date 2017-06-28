/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var common = require('../common');
var errors = require('../errors');

function do_resize(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length < 1) {
        callback(new errors.UsageError('missing INST arg'));
        return;
    } else if (args.length < 2) {
        callback(new errors.UsageError('missing PACKAGE arg'));
        return;
    }

    var id = args[0];
    var pkg = args[1];
    console.log('Resizing instance %s to "%s"', id, pkg);

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
            return;
        }

        tritonapi.resizeInstance({
            id: id,
            package: pkg,
            wait: opts.wait,
            waitTimeout: opts.wait_timeout * 1000
        }, function (err) {
            if (err) {
               callback(err);
               return;
            }
            console.log('Resized instance %s to "%s"', id, pkg);
            callback();
        });
    });
}


do_resize.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['wait', 'w'],
        type: 'bool',
        help: 'Block until resizing instance is complete.'
    },
    {
        names: ['wait-timeout'],
        type: 'positiveInteger',
        default: 120,
        help: 'The number of seconds to wait before timing out with an error. '
            + 'The default is 120 seconds.'
    }
];


do_resize.synopses = ['{{name}} resize [OPTIONS] INST PACKAGE'];
do_resize.help = [
    'Resize an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id',
    'and "PACKAGE" is a package name, id, or short id.',
    '',
    'Changing an instance package is asynchronous.',
    'Use "--wait" to not return until the changes are completed.'
].join('\n');

do_resize.completionArgtypes = ['tritoninstance', 'tritonpackage', 'none'];


module.exports = do_resize;
