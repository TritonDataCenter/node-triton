#!/usr/bin/env node
/**
 * Example creating a Triton API client and using it to list instances.
 *
 * Usage:
 *      ./example-list-instances.js
 *
 *      # With trace-level logging
 *      LOG_LEVEL=trace ./example-list-instances.js 2>&1 | bunyan
 */

var bunyan = require('bunyan');
var path = require('path');
var triton = require('../'); // typically `require('triton');`

var log = bunyan.createLogger({
    name: path.basename(__filename),
    level: process.env.LOG_LEVEL || 'info',
    stream: process.stderr
});

triton.createClient({
    log: log,
    // Use 'env' to pick up 'TRITON_/SDC_' env vars. Or manually specify a
    // `profile` object.
    profileName: 'env',
    unlockKeyFn: triton.promptPassphraseUnlockKey
}, function createdClient(err, client) {
    if (err) {
        console.error('error creating Triton client: %s\n%s', err, err.stack);
        process.exitStatus = 1;
        return;
    }

    // TODO: Eventually the top-level TritonApi will have `.listInstances()`.
    client.cloudapi.listMachines(function (err, insts) {
        client.close(); // Remember to close the client to close TCP conn.

        if (err) {
            console.error('listInstances error: %s\n%s', err, err.stack);
            process.exitStatus = 1;
        } else {
            console.log(JSON.stringify(insts, null, 4));
        }
    });
});
