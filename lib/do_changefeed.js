/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var util = require('util');

var common = require('./common');

function do_changefeed(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length !== 0) {
        callback(new Error('invalid args: ' + args));
        return;
    }


    var tritonapi = this.tritonapi;

    common.cliSetupTritonApi({
        cli: this
    }, function onSetup(setupErr) {
        if (setupErr) {
            callback(setupErr);
            return;
        }

        tritonapi.changeFeed(function cfCb(cfErr, wsc) {
            if (cfErr) {
                callback(cfErr);
                return;
            }

            wsc.on('text', function (data) {
                if (opts.json) {
                    console.log(data);
                } else {
                    var msg = JSON.parse(data);
                    console.log(util.format(
                        'Change (%s) =>',
                        new Date(Number(msg.published)).toISOString()));
                    console.log(common.indent([
                        'modified: ' + msg.changeKind.subResources,
                        'state: ' + msg.resourceState,
                        'internal state: ' + msg.resourceState,
                        'object: ' + common.uuidToShortId(msg.changedResourceId)
                    ].join('\n')));
                }
            });

            wsc.on('end', function (_code, _reason) {
                callback();
            });

            wsc.on('error', function (shedErr) {
                console.error(shedErr);
                callback(shedErr);
            });

            wsc.on('connectionReset', function () {
                console.log('Connect reset by peer');
                callback();
            });


            process.on('SIGINT', function() {
                wsc.end();
                process.exit();
            });
            var msg = {
                resource: 'vm',
                subResources: [
                    'alias',
                    'customer_metadata',
                    'destroyed',
                    'nics',
                    'owner_uuid',
                    'server_uuid',
                    'state',
                    'tags'
                ]
            };

            if (opts.instances) {
                msg.vms = opts.instances;
            }
            msg = JSON.stringify(msg);
            wsc.send(msg);
        });
    });
}


do_changefeed.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    },
    {
        names: ['instances'],
        type: 'arrayOfCommaSepString',
        help: 'Comma separated list of instance uuids to watch for changes.' +
            'If nothing is said, all the account instances are assumed.'
    }
];

do_changefeed.synopses = ['{{name}} {{cmd}}'];

do_changefeed.help = [
    'Subscribe to CloudAPI feed of VMs changes.',
    '',
    '{{usage}}',
    '',
    '{{options}}'
].join('\n');

module.exports = do_changefeed;
