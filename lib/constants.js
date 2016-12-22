/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

/*
 * node-triton constants.
 *
 * CLI usage:
 *      $ node lib/constants.js
 *      ... emits all the constants as a JSON object ...
 *      $ node lib/constants.js KEY
 *      ... emits the value of KEY (in json-y form, i.e. quotes removed from a
 *      string) ...
 */

var mod_path = require('path');


// ---- determining constants

/*
 * The `triton` CLI's config dir.
 *
 * For *testing* only, we allow override of this dir.
 */
var CLI_CONFIG_DIR;
if (process.env.TRITONTEST_CLI_CONFIG_DIR) {
    CLI_CONFIG_DIR = process.env.TRITONTEST_CLI_CONFIG_DIR;
} else if (process.platform === 'win32') {
    /*
     * For better or worse we are using APPDATA (i.e. the *Roaming* AppData
     * dir) over LOCALAPPDATA (non-roaming). The former is meant for "user"
     * data, the latter for "machine" data.
     *
     * TODO: We should likely separate out the *cache* subdir to
     * machine-specific data dir.
     */
    CLI_CONFIG_DIR = mod_path.resolve(process.env.APPDATA, 'Joyent', 'Triton');
} else {
    CLI_CONFIG_DIR = mod_path.resolve(process.env.HOME, '.triton');
}


// ---- exports

module.exports = {
    CLI_CONFIG_DIR: CLI_CONFIG_DIR
};


// ---- mainline

function main(argv) {
    var assert = require('assert-plus');
    var dashdash = require('cmdln').dashdash;

    assert.arrayOfString(argv, 'argv');

    var options = [
        {
            names: ['help', 'h'],
            type: 'bool',
            help: 'Print this help and exit.'
        }
    ];
    var parser = dashdash.createParser({options: options});
    try {
        var opts = parser.parse(argv);
    } catch (e) {
        console.error('lib/constants.js: error: %s', e.message);
        process.exit(1);
    }

    if (opts.help) {
        console.log([
            'usage: node .../lib/constants.js [OPTIONS] [KEY]',
            'options:',
            parser.help().trimRight()
        ].join('\n'));
        process.exit(0);
    }

    var key;
    if (opts._args.length === 1) {
        key = opts._args[0];
    } else if (opts._args.length === 0) {
        key = null;
    } else {
        console.error('lib/constants.js: error: too many args: %s',
            opts._args.join(' '));
        process.exit(1);
    }

    if (key) {
        var val = module.exports[key];
        if (typeof (val) === 'string') {
            console.log(val);
        } else {
            console.log(JSON.stringify(val, null, 4));
        }
    } else {
        console.log(JSON.stringify(module.exports, null, 4));
    }
}

if (require.main === module) {
    main(process.argv);
}
