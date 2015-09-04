/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton completion ...`
 */

function do_completion(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    console.log(this.bashCompletion());
    cb();
}

do_completion.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];
do_completion.help = [
    'Output bash completion code for the `triton` CLI.',
    '',
    'Installation:',
    '    triton completion >> ~/.bashrc',
    '',
    'Or maybe:',
    '    triton completion > /usr/local/etc/bash_completion.d/triton'
].join('\n');
do_completion.hidden = true;

module.exports = do_completion;
