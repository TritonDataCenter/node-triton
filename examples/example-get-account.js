#!/usr/bin/env node
/**
 * Example using cloudapi2.js to call cloudapi's GetAccount endpoint.
 *
 * Usage:
 *      ./example-get-account.js | bunyan
 */

var p = console.log;
var auth = require('smartdc-auth');
var bunyan = require('bunyan');
var cloudapi = require('../lib/cloudapi2');

var log = bunyan.createLogger({
    name: 'test-get-account',
    level: 'trace'
})

var USER = process.env.SDC_ACCOUNT || process.env.SDC_USER || 'bob';
var KEY_ID = process.env.SDC_KEY_ID || 'b4:f0:b4:6c:18:3b:44:63:b4:4e:58:22:74:43:d4:bc';

var sign = auth.cliSigner({
    keyId: KEY_ID,
    user: USER,
    log: log
});
var client = cloudapi.createClient({
    url: 'https://us-sw-1.api.joyentcloud.com',
    user: USER,
    version: '*',
    sign: sign,
    agent: false, // don't want KeepAlive
    log: log
});

log.info('start')
client.getAccount(function (err, account) {
    p('getAccount: err', err)
    p('getAccount: account', account)
});
