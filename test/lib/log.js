/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * bunyan logger for tests
 */

var bunyan = require('bunyan');
var restifyBunyan = require('restify-clients/lib/helpers/bunyan');

module.exports = bunyan.createLogger({
    name: 'node-triton-test',
    serializers: restifyBunyan.serializers,
    streams: [
        {
            level: process.env.LOG_LEVEL || 'error',
            stream: process.stderr
        }
    ]
});
