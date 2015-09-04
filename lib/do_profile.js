/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 *
 * `triton profile ...`
 */

var common = require('./common');



function do_profile(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }

    var profs = common.deepObjCopy(this.sdc.profiles);
    var currProfileName = this.sdc.profile.name;
    for (var i = 0; i < profs.length; i++) {
        profs[i].curr = (profs[i].name === currProfileName ? '*' : ' ');
        profs[i].dcs = (profs[i].dcs ? profs[i].dcs : ['all'])
            .join(',');
    }
    if (opts.json) {
        common.jsonStream(profs);
    } else {
        common.tabulate(profs, {
            columns: 'curr,name,dcs,user,keyId',
            sort: 'name,user',
            validFields: 'curr,name,dcs,user,keyId'
        });
    }
    callback();
}

do_profile.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    }
];
do_profile.help = (
    'Create, update or inpect joyent CLI profiles.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} profile\n'
    + '\n'
    + '{{options}}'
);


module.exports = do_profile;
