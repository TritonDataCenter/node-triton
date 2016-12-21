/*
 * Copyright 2016 Joyent Inc.
 *
 * Shared stuff for `triton profile ...` handling.
 */

var assert = require('assert-plus');
var auth = require('smartdc-auth');
var format = require('util').format;
var fs = require('fs');
var getpass = require('getpass');
var https = require('https');
var mkdirp = require('mkdirp');
var path = require('path');
var rimraf = require('rimraf');
var semver = require('semver');
var sshpk = require('sshpk');
var mod_url = require('url');
var vasync = require('vasync');
var which = require('which');
var wordwrap = require('wordwrap')(78);

var common = require('../common');
var mod_config = require('../config');
var errors = require('../errors');


// --- internal support functions

function portalUrlFromCloudapiUrl(url) {
    assert.string(url, 'url');
    var portalUrl;

    var JPC_RE = /^https:\/\/([a-z0-9-]+)\.api\.joyent(cloud)?\.com\/?$/;
    if (JPC_RE.test(url)) {
        return 'https://my.joyent.com';
    }
    return portalUrl;
}


function downloadUrl(opts, cb) {
    assert.string(opts.url, 'opts.url');
    assert.ok(/^https:/.test(opts.url));
    assert.string(opts.dest, 'opts.dest');
    assert.optionalBool(opts.insecure, 'opts.insecure');
    assert.func(cb, 'cb');

    var reqOpts = mod_url.parse(opts.url);
    if (opts.insecure) {
        reqOpts.rejectUnauthorized = false;
    }

    var file = fs.createWriteStream(opts.dest);
    var req = https.get(reqOpts, function (res) {
        res.pipe(file);
        file.on('finish', function () {
            file.close(cb);
        });
    });

    req.on('error', function (err) {
        fs.unlink(opts.dest);
        cb(err);
    });
}


// --- exported functions

function setCurrentProfile(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.func(cb, 'cb');
    var cli = opts.cli;

    if (opts.name === '-') {
        if (cli.tritonapi.config.hasOwnProperty('oldProfile')) {
            opts.name = cli.tritonapi.config.oldProfile;
        } else {
            cb(new errors.ConfigError('"oldProfile" is not set in config'));
            return;
        }
    }

    try {
        var profile = mod_config.loadProfile({
            configDir: cli.configDir,
            name: opts.name
        });
    } catch (err) {
        return cb(err);
    }

    var currProfile;
    try {
        currProfile = cli.tritonapi.profile;
    } catch (err) {
        // Ignore inability to load a profile.
        if (!(err instanceof errors.ConfigError)) {
            throw err;
        }
    }
    if (currProfile && currProfile.name === profile.name) {
        console.log('"%s" is already the current profile', profile.name);
        return cb();
    }

    mod_config.setConfigVars({
        configDir: cli.configDir,
        vars: {
            profile: profile.name
        }
    }, function (err) {
        if (err) {
            return cb(err);
        }
        console.log('Set "%s" as current profile', profile.name);
        cb();
    });
}


/**
 * Setup the given profile for Docker usage. This means checking the cloudapi
 * has a Docker service (ListServices), finding the user's SSH *private* key,
 * creating the client certs that will be used to talk to the Triton Docker
 * Engine.
 *
 * @param {Object} opts: Required.
 *      - {Object} cli: Required. The Triton CLI object.
 *      - {String} name: Required. The profile name.
 *      - {Boolean} implicit: Optional. Boolean indicating if the Docker setup
 *        is implicit (e.g. as a default part of `triton profile create`). If
 *        implicit, we silently skip if ListServices shows no Docker service.
 *      - {Object} keyPaths: Optional. An object with `private` and/or `public`
 *        properties pointing to a full path to an SSH private and/or public
 *        key to use for cert signing.
 */
function profileDockerSetup(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.optionalBool(opts.implicit, 'opts.implicit');
    assert.optionalObject(opts.keyPaths, 'opts.keyPaths');
    assert.func(cb, 'cb');

    var cli = opts.cli;
    var tritonapi = cli.tritonapiFromProfileName({profileName: opts.name});

    var implicit = Boolean(opts.implicit);
    var log = cli.log;

    var profile = tritonapi.profile;
    var dockerHost;

    vasync.pipeline({arg: {tritonapi: tritonapi}, funcs: [
        function dockerKeyWarning(arg, next) {
            console.log(wordwrap(
                '\nWARNING: Docker uses TLS-based authentication with a ' +
                 'different security model from SSH keys. As a result, the ' +
                    'Docker client cannot currently support encrypted ' +
                    '(password protected) keys or SSH agents. If you ' +
                    'continue, the Triton CLI will attempt to format a copy ' +
                    'of your SSH *private* key as an unencrypted TLS cert ' +
                    'and place the copy in ~/.triton/docker for use by the ' +
                    'Docker client.'));
            common.promptYesNo({msg: 'Continue? [y/n] '}, function (answer) {
                if (answer !== 'y') {
                    console.error('Skipping Docker setup (you can run '
                        + '"triton profile docker-setup" later).');
                    next(true);
                } else {
                    next();
                }
            });
        },

        common.cliSetupTritonApi,

        function checkCloudapiStatus(arg, next) {
            tritonapi.cloudapi.ping({}, function (err, pong, res) {
                if (!res) {
                    next(new errors.SetupError(err, format(
                        'error pinging CloudAPI <%s>', profile.url)));
                } else if (res.statusCode === 503) {
                    // TODO: Use maint res headers to estimate time back up.
                    next(new errors.SetupError(err, format('CloudAPI <%s> is ',
                        + 'in maintenance, please try again later',
                        profile.url)));
                } else if (res.statusCode === 200) {
                    next();
                } else {
                    next(new errors.SetupError(err, format(
                        'error pinging CloudAPI <%s>: %s status code',
                        profile.url, res.statusCode)));
                }
            });
        },

        function checkForDockerService(arg, next) {
            tritonapi.cloudapi.listServices({}, function (err, svcs, res) {
                if (!res) {
                    next(new errors.SetupError(err, format(
                        'could not list services on cloudapi %s',
                        profile.url)));
                } else if (res.statusCode === 401) {
                    var portalUrl = portalUrlFromCloudapiUrl(profile.url);
                    if (portalUrl) {
                        next(new errors.SetupError(err, format(
                            'invalid credentials. Visit <%s> to create the '
                            + '"%s" account and/or add your SSH public key',
                            portalUrl, profile.account)));
                    } else {
                        next(new errors.SetupError(err, format(
                            'invalid credentials. You must create the '
                            + '"%s" account and/or add your SSH public key',
                            profile.account)));
                    }
                } else if (res.statusCode === 200) {
                    if (svcs.docker) {
                        dockerHost = svcs.docker;
                        log.trace({dockerHost: dockerHost},
                            'profileDockerSetup: checkForDockerService');
                        next();
                    } else if (implicit) {
                        /*
                         * No Docker service on this CloudAPI and this is an
                         * implicit attempt to setup for Docker, so that's fine.
                         * Use the early-abort signal.
                         */
                        next(true);
                    } else {
                        next(new errors.SetupError(err, format(
                            'no "docker" service on this datacenter',
                            profile.url)));
                    }
                } else {
                    // TODO: If this doesn't show res details, add that.
                    next(new errors.SetupError(err, format(
                        'unexpected response from cloudapi %s: %s status code',
                        profile.url, res.statusCode)));
                }
            });
        },

        function mentionSettingUp(arg, next) {
            console.log('Setting up profile "%s" to use Docker.', profile.name);
            next();
        },

        function checkSshPrivKey(arg, next) {
            try {
                tritonapi.keyPair.getPrivateKey();
            } catch (e) {
                next(new errors.SetupError(format('could not obtain SSH ' +
                    'private key for keypair with fingerprint "%s" ' +
                    'to create Docker certificate.', profile.keyId)));
                return;
            }
            next();
        },

        /*
         * Find the `docker` version, if we can. This can be used later to
         * control some envvars that depend on the docker version.
         */
        function whichDocker(arg, next) {
            which('docker', function (err, dockerPath) {
                if (err) {
                    console.log(wordwrap('\nNote: No "docker" was found on '
                        + 'your PATH. It is not needed for this setup, but '
                        + 'will be to run docker commands against Triton. '
                        + 'You can find out how to install it at '
                        + '<https://docs.docker.com/engine/installation/>.'));
                } else {
                    arg.dockerPath = dockerPath;
                    log.trace({dockerPath: dockerPath},
                        'profileDockerSetup: whichDocker');
                }
                next();
            });
        },
        function getDockerClientVersion(arg, next) {
            if (!arg.dockerPath) {
                next();
                return;
            }
            common.execPlus({
                cmd: format('"%s" --version', arg.dockerPath),
                log: log
            }, function (err, stdout, stderr) {
                if (err) {
                    console.log(
                        '\nWarning: Could not determine Docker version:\n%s',
                        common.indent(err.toString()));
                } else {
                    // E.g.: 'Docker version 1.9.1, build a34a1d5'
                    // JSSTYLED
                    var DOCKER_VER_RE = /^Docker version (.*?), build/;
                    var match = DOCKER_VER_RE.exec(stdout);
                    if (!match) {
                        console.log('\nWarning: Could not determine Docker '
                            + 'version: output of `%s --version` does not '
                            + 'match %s: %j', arg.dockerPath, DOCKER_VER_RE,
                            stdout);
                    } else {
                        arg.dockerVersion = match[1];
                        log.trace({dockerVersion: arg.dockerVersion},
                            'profileDockerSetup: getDockerClientVersion');
                    }
                }
                next();
            });
        },


        function genClientCert_dir(arg, next) {
            arg.dockerCertPath = path.resolve(cli.configDir,
                'docker', common.profileSlug(profile));
            mkdirp(arg.dockerCertPath, next);
        },
        function genClientCert_key(arg, next) {
            arg.keyPath = path.resolve(arg.dockerCertPath, 'key.pem');
            var data = tritonapi.keyPair.getPrivateKey().toBuffer('pkcs1');
            fs.writeFile(arg.keyPath, data, function (err) {
                if (err) {
                    next(new errors.SetupError(err, format(
                        'error writing file %s', arg.keyPath)));
                } else {
                    next();
                }
            });
        },
        function genClientCert_cert(arg, next) {
            arg.certPath = path.resolve(arg.dockerCertPath, 'cert.pem');

            var privKey = tritonapi.keyPair.getPrivateKey();
            var id = sshpk.identityFromDN('CN=' + profile.account);
            var cert = sshpk.createSelfSignedCertificate(id, privKey);
            var data = cert.toBuffer('pem');

            fs.writeFile(arg.certPath, data, function (err) {
                if (err) {
                    next(new errors.SetupError(err, format(
                        'error writing file %s', arg.keyPath)));
                } else {
                    next();
                }
            });
        },

        function getServerCa(arg, next) {
            arg.caPath = path.resolve(arg.dockerCertPath, 'ca.pem');
            var caUrl = dockerHost.replace(/^tcp:/, 'https:') + '/ca.pem';
            downloadUrl({
                url: caUrl,
                dest: arg.caPath,
                insecure: profile.insecure
            }, next);
        },

        function writeSetupJson(arg, next) {
            var setupJson = path.resolve(arg.dockerCertPath, 'setup.json');
            var setup = {
                profile: profile,
                time: (new Date()).toISOString(),
                env: {
                    DOCKER_CERT_PATH: arg.dockerCertPath,
                    DOCKER_HOST: dockerHost,
                    DOCKER_TLS_VERIFY: '1'
                }
            };

            if (profile.insecure) {
                setup.env.DOCKER_TLS_VERIFY = null; // signal to unset it
            } else {
                setup.env.DOCKER_TLS_VERIFY = '1';
            }

            /*
             * Docker version 1.9.0 was released at the same time as
             * Docker Compose 1.5.0. In that version they changed from using
             * DOCKER_CLIENT_TIMEOUT to COMPOSE_HTTP_TIMEOUT and,
             * annoyingly, added a warning that the user sees for all
             * `compose ...` runs about DOCKER_CLIENT_TIMEOUT being
             * deprecated. We want to avoid that deprecation message,
             * but need the timeout value.
             *
             * This isn't fool proof (using mismatched `docker` and
             * `docker-compose` versions). It is debatable if we want to
             * play this game. E.g. someone moving from Docker 1.8 to newer,
             * *but not re-setting up envvars* may start hitting timeouts.
             *
             * TODO: consider using `docker-compose` version on PATH?
             */
            if (!arg.dockerVersion) {
                setup.env.DOCKER_CLIENT_TIMEOUT = '300';
                setup.env.COMPOSE_HTTP_TIMEOUT = '300';
            } else if (semver.gte(arg.dockerVersion, '1.9.0')) {
                setup.env.COMPOSE_HTTP_TIMEOUT = '300';
            } else {
                setup.env.DOCKER_CLIENT_TIMEOUT = '300';
            }

            fs.writeFile(setupJson,
                JSON.stringify(setup, null, 4) + '\n',
                next);
        },

        function mentionSuccess(arg, next) {
            console.log(
                'Setup profile "%s" to use Docker%s. Try this:\n'
                + '    eval "$(triton env --docker%s)"\n'
                + '    docker%s info',
                profile.name,
                (arg.dockerVersion ? format(' (v%s)', arg.dockerVersion) : ''),
                (profile.name === cli.profileName ? '' : ' ' + profile.name),
                (profile.insecure ? ' --tls' : ''));
            next();
        }

    ]}, function (err) {
        tritonapi.close();

        if (err === true) { // Early-abort signal.
            err = null;
        }
        if (err && !dockerHost && implicit) {
            console.error('Warning: Error determining ' +
                'if CloudAPI "%s" provides a Docker service:\n    %s',
                profile.url, err);
            err = null;
        }

        cb(err);
    });
}


module.exports = {
    setCurrentProfile: setCurrentProfile,
    profileDockerSetup: profileDockerSetup
};
