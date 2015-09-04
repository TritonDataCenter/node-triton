/*
 * Copyright 2015 Joyent Inc.
 *
 * `triton account ...`
 */

var common = require('./common');

function do_keys(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }

    this.tritonapi.cloudapi.listKeys(function (err, keys) {
        if (err) {
            callback(err);
            return;
        }

        if (opts.json) {
            common.jsonStream(keys);
        } else {
            // pretty print
            keys.forEach(function (key) {
                console.log(key.key);
            });
        }
        callback();
    });
}

do_keys.options = [
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
do_keys.help = (
    'Show public keys.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} keys\n'
    + '\n'
    + '{{options}}'
);

module.exports = do_keys;
