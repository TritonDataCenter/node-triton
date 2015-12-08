/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 */

var assert = require('assert-plus');

var bunyannoop = require('./bunyannoop');
var mod_config = require('./config');
var tritonapi = require('./tritonapi');


/**
 * A convenience wrapper around `tritonapi.createClient` to for simpler usage.
 *
 * Minimally this only requires that one of `profileName` or `profile` be
 * specified. Examples:
 *
 *      var triton = require('triton');
 *      var client = triton.createClient({
 *          profile: {
 *              url: "<cloudapi url>",
 *              account: "<account login for this cloud>",
 *              keyId: "<ssh key fingerprint for one of account's keys>"
 *          }
 *      });
 *      --
 *      // Loading a profile from the environment (the `TRITON_*` and/or
 *      // `SDC_*` environment variables).
 *      var client = triton.createClient({profileName: 'env'});
 *      --
 *      var client = triton.createClient({
 *          configDir: '~/.triton',     // use the CLI's config dir ...
 *          profileName: 'east1'        // ... to find named profiles
 *      });
 *      --
 *      // The same thing using the underlying APIs.
 *      var client = triton.createClient({
 *          config: triton.loadConfig({configDir: '~/.triton'},
 *          profile: triton.loadProfile({name: 'east1', configDir: '~/.triton'})
 *      });
 *
 * A more complete example an app using triton internally might want:
 *
 *      var triton = require('triton');
 *      var bunyan = require('bunyan');
 *
 *      var appConfig = {
 *          // However the app handles its config.
 *      };
 *      var log = bunyan.createLogger({name: 'myapp', component: 'triton'});
 *      var client = triton.createClient({
 *          log: log,
 *          profile: appConfig.tritonProfile
 *      });
 *
 *
 * TODO: The story for an app wanting to specify some Triton config but NOT
 * have to have a triton $configDir/config.json is poor.
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
 *        Either `profile` or `profileName` is requires. See discussion above.
 *      - @param configDir {String} A base config directory. This is used
 *        by TritonApi to find and store profiles, config, and cache data.
 *        For example, the `triton` CLI uses "~/.triton".
 *        One may not specify both `configDir` and `config`.
 *      - @param config {Object} A Triton config object loaded by
 *        `triton.loadConfig(...)`.
 *        One may not specify both `configDir` and `config`.
 *      - @param log {Bunyan Logger} Optional. A Bunyan logger. If not provided,
 *        a stub that does no logging will be used.
 */
function createClient(opts) {
    assert.object(opts, 'opts');
    assert.optionalObject(opts.profile, 'opts.profile');
    assert.optionalString(opts.profileName, 'opts.profileName');
    assert.optionalObject(opts.config, 'opts.config');
    assert.optionalString(opts.configDir, 'opts.configDir');
    assert.optionalObject(opts.log, 'opts.log');

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

    var log = opts.log;
    if (!opts.log) {
        log = new bunyannoop.BunyanNoopLogger();
    }

    var config = opts.config;
    if (!config) {
        config = mod_config.loadConfig({configDir: opts.configDir});
    }

    var profile = opts.profile;
    if (!profile) {
        profile = mod_config.loadProfile({
            name: opts.profileName,
            configDir: config._configDir
        });
    }
    // Don't require one to arbitrarily have a profile.name if manually
    // creating it.
    if (!profile.name) {
        // TODO: might want this to be hash or slug of profile params.
        profile.name = '_';
    }
    mod_config.validateProfile(profile);

    var client = tritonapi.createClient({
        log: log,
        config: config,
        profile: profile
    });
    return client;
}


module.exports = {
    createClient: createClient,

    /**
     * `createClient` provides convenience parameters to not *have* to call
     * the following (i.e. passing in `configDir` and/or `profileName`), but
     * some users of node-triton as a module may want to call these directly.
     */
    loadConfig: mod_config.loadConfig,
    loadProfile: mod_config.loadProfile,
    loadAllProfiles: mod_config.loadAllProfiles,

    createTritonApiClient: tritonapi.createClient,
    // For those wanting a lower-level raw CloudAPI client.
    createCloudApiClient: require('./cloudapi2').createClient
};
