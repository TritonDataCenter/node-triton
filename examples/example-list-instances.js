#!/usr/bin/env node
/**
 * Example using cloudapi2.js to call cloudapi's ListMachines endpoint.
 *
 * Usage:
 *      ./example-list-images.js | bunyan
 */

var p = console.log;
var bunyan = require('bunyan');
var triton = require('../'); // typically `require('triton');`


var URL = process.env.SDC_URL || 'https://us-sw-1.api.joyent.com';
var ACCOUNT = process.env.SDC_ACCOUNT || 'bob';
var KEY_ID = process.env.SDC_KEY_ID || 'b4:f0:b4:6c:18:3b:44:63:b4:4e:58:22:74:43:d4:bc';


var log = bunyan.createLogger({
    name: 'test-list-instances',
    level: process.env.LOG_LEVEL || 'trace'
});

/*
 * More details on `createClient` options here:
 *      https://github.com/joyent/node-triton/blob/master/lib/index.js#L18-L61
 * For example, if you want to use an existing `triton` CLI profile, you can
 * pass that profile name in.
 */
var client = triton.createClient({
    log: log,
    profile: {
        url: URL,
        account: ACCOUNT,
        keyId: KEY_ID
    }
});
// TODO: Eventually the top-level TritonApi will have `.listInstances()` to use.
client.cloudapi.listMachines(function (err, insts) {
    client.close();   // Remember to close the client to close TCP conn.
    if (err) {
        console.error('listInstances err:', err);
    } else {
        console.log(JSON.stringify(insts, null, 4));
    }
});