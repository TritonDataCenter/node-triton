/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton completion ...`
 */

var fs = require('fs');
var path = require('path');

var CloudApi = require('./cloudapi2').CloudApi;
var UPDATE_ACCOUNT_FIELDS = CloudApi.prototype.UPDATE_ACCOUNT_FIELDS;
var UPDATE_FWRULE_FIELDS = CloudApi.prototype.UPDATE_FWRULE_FIELDS;


// Replace {{variable}} in `s` with the template data in `d`.
function renderTemplate(s, d) {
    return s.replace(/{{([a-zA-Z_]+)}}/g, function (match, key) {
        return d.hasOwnProperty(key) ? d[key] : match;
    });
}


function do_completion(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    }

    if (opts.raw) {
        console.log(this.bashCompletionSpec());
    } else {
        var specExtraIn = fs.readFileSync(
            path.join(__dirname, '../etc/triton-bash-completion-types.sh'),
            'utf8');
        var specExtra = renderTemplate(specExtraIn, {
            UPDATE_ACCOUNT_FIELDS: Object.keys(UPDATE_ACCOUNT_FIELDS).sort()
                .map(function (field) { return field + '='; }).join(' '),
            UPDATE_FWRULE_FIELDS: Object.keys(UPDATE_FWRULE_FIELDS).sort()
                .map(function (field) { return field + '='; }).join(' ')
        });
        console.log(this.bashCompletion({specExtra: specExtra}));
    }
    cb();
}

do_completion.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['raw'],
        type: 'bool',
        hidden: true,
        help: 'Only output the Bash completion "spec". ' +
            'This is only useful for debugging.'
    }
];
do_completion.help = [
    'Emit bash completion. See help for installation.',
    '',
    'Installation:',
    '    {{name}} completion > /usr/local/etc/bash_completion.d/{{name}} # Mac',
    '    sudo {{name}} completion > /etc/bash_completion.d/{{name}} # Linux',
    '',
    'Alternative installation:',
    '    {{name}} completion > ~/.{{name}}.completion',
    '    echo "source ~/.{{name}}.completion" >> ~/.bashrc',
    '',
    '{{options}}'
].join('\n');

module.exports = do_completion;
