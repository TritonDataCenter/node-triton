/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var common = require('../common');
var errors = require('../errors');


function perror(err) {
    console.error('error: %s', err.message);
}

function do_rename(subcmd, opts, args, callback) {
    var self = this;
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
    var cOpts = {id: args[0], name: args[1]};
    self.top.tritonapi.renameInstance(cOpts, function (err) {
       if (err) {
           callback(err);
           return;
        }
        console.log('Renamed instance %s to "%s"', cOpts.id, cOpts.name);
        callback();
    });
}


do_rename.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
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
    'and "NEWNAME" is an instance name.'
].join('\n');

do_rename.completionArgtypes = ['tritoninstance', 'none'];


module.exports = do_rename;
