/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton image wait ...`
 */

var vasync = require('vasync');

var common = require('../common');
var distractions = require('../distractions');
var errors = require('../errors');


function do_wait(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return this.do_help('help', {}, [subcmd], cb);
    } else if (args.length < 1) {
        return cb(new errors.UsageError('missing IMAGE arg(s)'));
    }
    var ids = args;
    var states = [];
    opts.states.forEach(function (s) {
        /* JSSTYLED */
        states = states.concat(s.trim().split(/\s*,\s*/g));
    });

    var distraction;
    var done = 0;
    var imgFromId = {};

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        common.cliSetupTritonApi,
        function getImgs(_, next) {
            vasync.forEachParallel({
                inputs: ids,
                func: function getImg(id, nextImg) {
                    self.top.tritonapi.getImage(id, function (err, img) {
                        if (err) {
                            return nextImg(err);
                        }
                        if (states.indexOf(img.state) !== -1) {
                            console.log('%d/%d: Image %s (%s@%s) already %s',
                                ++done, ids.length, img.id, img.name,
                                img.version, img.state);
                        } else {
                            imgFromId[img.id] = img;
                        }
                        nextImg();
                    });
                }
            }, next);
        },

        function waitForImgs(_, next) {
            var idsToWaitFor = Object.keys(imgFromId);
            if (idsToWaitFor.length === 0) {
                return next();
            }

            if (idsToWaitFor.length === 1) {
                var img2 = imgFromId[idsToWaitFor[0]];
                console.log(
                    'Waiting for image %s (%s@%s) to enter state (states: %s)',
                    img2.id, img2.name, img2.version, states.join(', '));
            } else {
                console.log(
                    'Waiting for %d images to enter state (states: %s)',
                    idsToWaitFor.length, states.join(', '));
            }

            /*
             * TODO: need BigSpinner.log first.
             * TODO: Also when adding a spinner, we need an equiv option to
             * `triton create -wwww` to trigger the spinner (and size). By
             * default: no spinner.
             */
            if (false &&
                process.stderr.isTTY)
            {
                distraction = distractions.createDistraction();
            }

            vasync.forEachParallel({
                inputs: idsToWaitFor,
                func: function waitForImg(id, nextImg) {
                    self.top.tritonapi.cloudapi.waitForImageStates({
                        id: id,
                        states: states
                    }, function (err, img, res) {
                        if (err) {
                            return nextImg(err);
                        }
                        console.log('%d/%d: Image %s (%s@%s) moved to state %s',
                            ++done, ids.length, img.id, img.name,
                            img.version, img.state);
                        nextImg();
                    });
                }
            }, next);
        }

    ]}, function (err) {
        if (distraction) {
            distraction.destroy();
        }
        cb(err);
    });
}

do_wait.synopses = ['{{name}} {{cmd}} [-s STATES] IMAGE [IMAGE ...]'];

do_wait.help = [
    'Wait for images to change to a particular state.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "states" is a comma-separated list of target instance states,',
    'by default "active,failed". In other words, "triton img wait foo0" will',
    'wait for image "foo0" to complete creation.'
].join('\n');

do_wait.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['states', 's'],
        type: 'arrayOfString',
        default: ['active', 'failed'],
        helpArg: 'STATES',
        help: 'Instance states on which to wait. Default is "active,failed". '
            + 'Values can be comma-separated or multiple uses of the option.'
    }
];

do_wait.completionArgtypes = ['tritonimage'];

module.exports = do_wait;
