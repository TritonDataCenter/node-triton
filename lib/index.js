/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var bunyannoop = require('./bunyannoop');
var mod_common = require('./common');
var mod_config = require('./config');
var mod_cloudapi2 = require('./cloudapi2');
var mod_tritonapi = require('./tritonapi');


/* BEGIN JSSTYLED */
/**
 * A convenience wrapper around `tritonapi.TritonApi` for simpler usage.
 * Conveniences are:
 * - It wraps up the 3-step process of TritonApi client preparation into
 *   this one call.
 * - It accepts optional `profileName` and `configDir` parameters that will
 *   load a profile by name and load a config, respectively.
 *
 * Client preparation is a 3-step process:
 *
 *  1. create the client object;
 *  2. initialize it (mainly involves finding the SSH key identified by the
 *     `keyId`); and,
 *  3. optionally unlock the SSH key (if it is passphrase-protected and not in
 *     an ssh-agent).
 *
 * The simplest usage that handles all of these is:
 *
 *      var mod_triton = require('triton');
 *      mod_triton.createClient({
 *          profileName: 'env',
 *          unlockKeyFn: triton.promptPassphraseUnlockKey
 *      }, function (err, client) {
 *          if (err) {
 *              // handle err
 *          }
 *
 *          // use `client`
 *      });
 *
 * Minimally, only of `profileName` or `profile` is required. Examples:
 *
 *      // Manually specify profile parameters.
 *      mod_triton.createClient({
 *          profile: {
 *              url: "<cloudapi url>",
 *              account: "<account login for this cloud>",
 *              keyId: "<ssh key fingerprint for one of account's keys>"
 *          }
 *      }, function (err, client) { ... });
 *
 *      // Loading a profile from the environment (the `TRITON_*` and/or
 *      // `SDC_*` environment variables).
 *      triton.createClient({profileName: 'env'},
 *          function (err, client) { ... });
 *
 *      // Use one of the named profiles from the `triton` CLI.
 *      triton.createClient({
 *          configDir: '~/.triton',
 *          profileName: 'east1'
 *      }, function (err, client) { ... });
 *
 *      // The same thing using the underlying APIs.
 *      triton.createClient({
 *          config: triton.loadConfig({configDir: '~/.triton'}),
 *          profile: triton.loadProfile({name: 'east1', configDir: '~/.triton'})
 *      }, function (err, client) { ... });
 *
 * TODO: The story for an app wanting to specify some Triton config but NOT
 * have to have a triton $configDir/config.json is poor.
 *
 *
 * # What is that `unlockKeyFn` about?
 *
 * Triton uses HTTP-Signature auth: an SSH private key is used to sign requests.
 * The server-side authenticates by verifying that signature using the
 * previously uploaded public key. For the client to sign a request it needs an
 * unlocked private key: an SSH private key that (a) is not
 * passphrase-protected, (b) is loaded in an ssh-agent, or (c) for which we
 * have a passphrase.
 *
 * If `createClient` finds that its key is locked, it will use `unlockKeyFn`
 * as follows to attempt to unlock it:
 *
 *      unlockKeyFn({
 *          tritonapi: client
 *      }, function (unlockErr) {
 *          // ...
 *      });
 *
 * This package exports a convenience `promptPassphraseUnlockKey` function that
 * will prompt the user for a passphrase on stdin. Your tooling can use this
 * function, provide your own, or skip key unlocking.
 *
 * The failure mode for a locked key is an error like this:
 *
 *      SigningError: error signing request: SSH private key id_rsa is locked (encrypted/password-protected). It must be unlocked before use.
 *          at SigningError._TritonBaseVError (/Users/trentm/tmp/node-triton/lib/errors.js:55:12)
 *          at new SigningError (/Users/trentm/tmp/node-triton/lib/errors.js:173:23)
 *          at CloudApi._getAuthHeaders (/Users/trentm/tmp/node-triton/lib/cloudapi2.js:185:22)
 *
 *
 * @param opts {Object}:
 *      - @param profile {Object} A *Triton profile* object that includes the
 *        information required to connect to a CloudAPI -- minimally this:
 *              {
 *                  "url": "<cloudapi url>",
 *                  "account": "<account login for this cloud>",
 *                  "keyId": "<ssh key fingerprint for one of account's keys>"
 *              }
 *        For example:
 *              {
 *                  "url": "https://us-east-1.api.joyent.com",
 *                  "account": "billy.bob",
 *                  "keyId": "de:e7:73:9a:aa:91:bb:3e:72:8d:cc:62:ca:58:a2:ec"
 *              }
 *        Either `profile` or `profileName` is requires. See discussion above.
 *      - @param profileName {String} A Triton profile name. For any profile
 *        name other than "env", one must also provide either `configDir`
 *        or `config`.
 *        Either `profile` or `profileName` is required. See discussion above.
 *      - @param configDir {String} A base config directory. This is used
 *        by TritonApi to find and store profiles, config, and cache data.
 *        For example, the `triton` CLI uses "~/.triton".
 *        One may not specify both `configDir` and `config`.
 *      - @param config {Object} A Triton config object loaded by
 *        `triton.loadConfig(...)`.
 *        One may not specify both `configDir` and `config`.
 *      - @param log {Bunyan Logger} Optional. A Bunyan logger. If not provided,
 *        a stub that does no logging will be used.
 *      - @param {Function} unlockKeyFn - Optional. A function to handle
 *        unlocking the SSH key found for this profile, if necessary. It must
 *        be of the form `function (opts, cb)` where `opts.tritonapi` is the
 *        initialized TritonApi client. If the caller is a command-line
 *        interface, then `triton.promptPassphraseUnlockKey` can be used to
 *        prompt on stdin for the SSH key passphrase, if needed.
 * @param {Function} cb - `function (err, client)`
 */
/* END JSSTYLED */
function createClient(opts, cb) {
    assert.object(opts, 'opts');
    assert.optionalObject(opts.profile, 'opts.profile');
    assert.optionalString(opts.profileName, 'opts.profileName');
    assert.optionalObject(opts.config, 'opts.config');
    assert.optionalString(opts.configDir, 'opts.configDir');
    assert.optionalObject(opts.log, 'opts.log');
    assert.optionalFunc(opts.unlockKeyFn, 'opts.unlockKeyFn');
    assert.func(cb, 'cb');

    assert.ok(!(opts.profile && opts.profileName),
        'cannot specify both opts.profile and opts.profileName');
    assert.ok(!(!opts.profile && !opts.profileName),
        'must specify one opts.profile or opts.profileName');
    assert.ok(!(opts.config && opts.configDir),
        'cannot specify both opts.config and opts.configDir');
    assert.ok(!(opts.config && opts.configDir),
        'cannot specify both opts.config and opts.configDir');
    if (opts.profileName && opts.profileName !== 'env') {
        assert.ok(opts.configDir,
            'must provide opts.configDir for opts.profileName!="env"');
    }

    var log;
    var client;

    vasync.pipeline({funcs: [
        function theSyncPart(_, next) {
            log = opts.log || new bunyannoop.BunyanNoopLogger();

            var config;
            if (opts.config) {
                config = opts.config;
            } else {
                try {
                    config = mod_config.loadConfig(
                        {configDir: opts.configDir});
                } catch (configErr) {
                    next(configErr);
                    return;
                }
            }

            var profile;
            if (opts.profile) {
                profile = opts.profile;
                /*
                 * Don't require one to arbitrarily have a profile.name if
                 * manually creating it.
                 */
                if (!profile.name) {
                    // TODO: might want this to be a hash/slug of params.
                    profile.name = '_';
                }
            } else {
                try {
                    profile = mod_config.loadProfile({
                        name: opts.profileName,
                        configDir: config._configDir
                    });
                } catch (profileErr) {
                    next(profileErr);
                    return;
                }
            }
            try {
                mod_config.validateProfile(profile);
            } catch (valErr) {
                next(valErr);
                return;
            }

            client = mod_tritonapi.createClient({
                log: log,
                config: config,
                profile: profile
            });
            next();
        },
        function initTheClient(_, next) {
            client.init(next);
        },
        function optionallyUnlockKey(_, next) {
            if (!opts.unlockKeyFn) {
                next();
                return;
            }

            opts.unlockKeyFn({tritonapi: client}, next);
        }
    ]}, function (err) {
        log.trace({err: err}, 'createClient complete');
        if (err) {
            cb(err);
        } else {
            cb(null, client);
        }
    });
}


module.exports = {
    createClient: createClient,
    promptPassphraseUnlockKey: mod_common.promptPassphraseUnlockKey,

    /**
     * `createClient` provides convenience parameters to not *have* to call
     * the following (i.e. passing in `configDir` and/or `profileName`), but
     * some users of node-triton as a module may want to call these directly.
     */
    loadConfig: mod_config.loadConfig,
    loadProfile: mod_config.loadProfile,
    loadAllProfiles: mod_config.loadAllProfiles,

    /*
     * For those wanting a lower-level TritonApi createClient, or an
     * even *lower*-level raw CloudAPI client.
     */
    createTritonApiClient: mod_tritonapi.createClient,
    createCloudApiClient: mod_cloudapi2.createClient
};
