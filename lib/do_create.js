/*
 * Copyright (c) 2015 Joyent Inc. All rights reserved.
 *
 * `triton images ...`
 */

var format = require('util').format;
var tabula = require('tabula');

var errors = require('./errors');


function do_create(subcmd, opts, args, callback) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], callback);
        return;
    } else if (args.length > 1) {
        return callback(new Error('too many args: ' + args));
    }
    var triton = this.triton;

    // XXX The smarts here should move to Triton class.

    assert.string(opts.image, '--image <img>');
    assert.string(opts['package'], '--package <pkg>');
    assert.number(opts.count)

    // XXX
    /*
     * Should all this move into sdc.createMachine? yes
     *
     * - lookup image, package, networks from args
     * - assign names
     * - start provisions (slight stagger, max N at a time)
     * - return immediately, or '-w|--wait'
     */
    async.series([
        function lookups(next) {
            async.parallel([
                //XXX
                //sdc.lookup(image)
            ])
        },
        function provisions(next) {

        },
        function wait(next) {
            next();
        }
    ], function (err) {
        callback(err);
    });
};
do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['dc', 'd'],
        type: 'string',
        helpArg: '<dc>',
        help: 'The datacenter in which to provision. Required if the current'
            + ' profile includes more than one datacenter. Use `sdc profile`'
            + ' to list profiles and `sdc dcs` to list available datacenters.'
    },
    {
        names: ['image', 'i'],
        type: 'string',
        helpArg: '<img>',
        help: 'The machine image with which to provision. Required.'
    },
    {
        names: ['package', 'p'],
        type: 'string',
        helpArg: '<pkg>',
        help: 'The package or instance type for the new machine(s). Required.'
    },
    {
        names: ['name', 'n'],
        type: 'string',
        helpArg: '<name>',
        help: 'A name for the machine. If not specified, a short random name'
            + ' will be generated.',
        // TODO: for count>1 support '%d' code in name: foo0, foo1, ...
    },
    {
        names: ['count', 'c'],
        type: 'positiveInteger',
        'default': 1,
        helpArg: '<n>',
        help: 'The number of machines to provision. Default is 1.'
    },
];
do_create.help = (
    'Create a new instance.\n'
    + '\n'
    + 'Usage:\n'
    + '     {{name}} create <options>\n'
    + '\n'
    + '{{options}}'
);
do_create.aliases = ['create-inst'];

module.exports = do_create;
