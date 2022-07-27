/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 *
 * Client library for watch migration end-point of SmartDataCenter Cloud API.
 * http://apidocs.tritondatacenter.com/cloudapi/
 */


/* jsl:ignore */
'use strict';
/* jsl:end */

var assert = require('assert-plus');

var errors = require('../../errors');

var CloudAPI = require('../../cloudapi2').CloudApi;
var HttpClient = require('restify-clients').HttpClient;
HttpClient.prototype.post = function post(options, callback) {
    var opts = this._options('POST', options);
    return (this.request(opts, callback));
};

function elapsed(_start) {
    var delta = process.hrtime(_start);
    return (delta[0] + (delta[1] / 1e9)).toFixed(6).substr(0, 8);
}

function humanizeNetworkSpeed(speed) {
    if (typeof (speed) !== 'number') {
        return speed;
    }
    var i = 0;
    var byteUnits = ['B/s', 'kB/s', 'MB/s', 'GB/s', 'TB/s', 'PB/s', 'EB/s'];
    while (speed > 1024 && i < byteUnits.length) {
        speed = speed / 1024; i++;
    }
    return Math.max(speed, 0).toFixed(1) + byteUnits[i];
}

var util = require('util');

/*
 * Migration watch end-point streams JSON as migration events progress through
 * the migration process. Usage of restify JSON client could result in JSON
 * parse errors because the data stream may or may not be complete JSON data
 * chunks.
 *
 * Instead of waiting until the end of the whole process in order to get any
 * feedback -- which is what the default restify JSONClient would do -- we use
 * the HttpClient and provide immediate information to the user.
 *
 * Expected options are exactly the same as the `CloudAPI` constructor.
 *
 * From any CLI subcommand, those can be obtained from the current TritonAPI
 * instance by using:
 *
 *      var _cloudapiOpts = cli.tritonapi._cloudapiOpts;
 *      var _watcher = new Watcher(_cloudapiOpts);
 */
function Watcher(options) {
    CloudAPI.call(this, options);
    this.client = new HttpClient(options);
}

util.inherits(Watcher, CloudAPI);

/*
 * Watch a migration in progress for the provided machine `id`.
 *
 * Callback will be called with any error that may happen while watching
 * the migration and, in case no error happens, with a list of migration
 * progress events.
 *
 *      `watchCb(watchErr, migrationProgressEvents);`
 *
 * @param {Object} `watchOpts`:
 *      - `id`: UUID of the machine whose migration we want to watch
 *      - `json`: Boolean. Provide output messages as raw JSON or format them
 *          for user feedback. (False by default)
 *      - `quiet`: Boolean. Do not print any progress messages during the
 *          watching process. (False by default)
 */
Watcher.prototype.watchMigration = function watchMigration(watchOpts, watchCb) {
    assert.object(watchOpts, 'opts');
    assert.uuid(watchOpts.id, 'opts.id');
    assert.optionalBool(watchOpts.json, 'opts.json');
    assert.optionalBool(watchOpts.quiet, 'opts.quiet');
    assert.func(watchCb, 'cb');

    var self = this;

    var watchEnded = false;
    var socketClosed = false;

    var quiet = Boolean(watchOpts.quiet || false);
    var jsonOutput = Boolean(watchOpts.json || false);

    var progressEvents = [];
    var currProgress = 0;

    this._request({
        method: 'POST',
        path: util.format('/%s/machines/%s/migrate?action=watch',
            this.account, watchOpts.id)
    }, function reqCb(reqErr, req) {
        var taskStart = process.hrtime();

        req.on('close', function _watchReqCloseCb() {
            self.log.trace({
                progressEvents: progressEvents,
                elapsed: elapsed(taskStart)
            }, 'watchVmMigration:: watch request closed');

            if (!watchEnded) {
                socketClosed = true;
                watchCb(null, progressEvents);
            }
        });

        req.on('result', function resultCb(resErr, res) {
            if (resErr) {
                watchCb(resErr);
                return;
            }

            var pending = null;

            res.setEncoding('utf8');

            function onDataCb(chunk) {
                self.log.trace({
                    elapsed: elapsed(taskStart),
                    chunk: chunk
                }, 'Received migration data');

                var frags = [];
                var rawFrags = chunk.trim().split('\n');
                var errs = [];

                // If we have half a fragment from previous
                // chunk, we should prepend it to first fragment now:
                if (pending) {
                    rawFrags[0] = pending + rawFrags[0];
                    pending = null;
                }

                var lastIndex = rawFrags.length - 1;

                rawFrags.forEach(function parseFrag(frag, index) {
                    try {
                        frag = JSON.parse(frag);
                        frags.push(frag);
                    } catch (jsonErr) {
                        if (index === lastIndex &&
                            jsonErr instanceof SyntaxError &&
                            jsonErr.message ===
                            'Unexpected end of JSON input') {
                            pending = frag;
                        } else {
                            errs.push(new errors.InvalidContentError(
                                'Invalid JSON in response'));
                        }
                    }
                });

                if (errs.length) {
                    resErr = new errors.MultiError({errs: errs});
                    res.removeListener('data', onDataCb);
                    watchCb(resErr);
                    return;
                }

                function printEvent(evt) {
                    if (quiet) {
                        return;
                    }

                    if (jsonOutput) {
                        console.log(JSON.stringify(evt));
                        return;
                    }

                    if (evt.type === 'end') {
                        console.log('Done - %s finished in %d seconds',
                            evt.phase, elapsed(taskStart));
                        return;
                    }

                    // These must be 'progress' events
                    var state = evt.state;
                    // Some adjustments to progress only if we're not dealing
                    // with bytes:
                    if (evt.total_progress === 100) {
                        if (evt.current_progress <= currProgress) {
                            evt.current_progress += currProgress;
                        }
                    }
                    var percent = (evt.current_progress * 100) /
                            evt.total_progress;

                    currProgress = percent;
                    var mbps = evt.transfer_bytes_second ?
                        humanizeNetworkSpeed(evt.transfer_bytes_second) :
                        evt.message;

                    console.log('%s: %d%% %s', state, percent, mbps);
                }

                if (Array.isArray(frags)) {
                    frags.forEach(function printFrag(frag) {
                        printEvent(frag);
                        progressEvents.push(frag);
                    });
                } else {
                    printEvent(frags);
                    progressEvents.push(frags);
                }
            }

            res.on('data', onDataCb);

            res.on('timeout', function _watchResTimeout() {
                self.log.trace({
                    elapsed: elapsed(taskStart)
                }, 'watchMigration:: response timeout');
            });

            res.on('end', function onEndCb() {
                self.log.trace({
                    progressEvents: progressEvents,
                    elapsed: elapsed(taskStart)
                }, 'watchMigration:: response finished');

                if (!socketClosed) {
                    watchEnded = true;
                    watchCb(resErr, progressEvents);
                }
            });
        });

        req.end();
    });
};

module.exports = {
    Watcher: Watcher
};
