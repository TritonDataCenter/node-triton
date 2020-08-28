/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
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
var sshpk_agent = require('sshpk-agent');
var mod_url = require('url');
var crypto = require('crypto');
var vasync = require('vasync');
var VError = require('verror');
var which = require('which');
var wordwrap = require('wordwrap')(78);

var common = require('../common');
var mod_config = require('../config');
var errors = require('../errors');

var DEFAULT_CERT_LIFETIME = 3650;
var SECONDS_PER_DAY = 60 * 60 * 24; // 86400s

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
        fs.unlink(opts.dest, function onUnlink(unlinkErr) {
            if (unlinkErr) {
                cb(VError.errorFromList([err, unlinkErr]));
            } else {
                cb(err);
            }
        });
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
 * Generate a cmon certificate/key pair for the given profile. This means
 * checking the cloudapi has a cmon service (ListServices), finding the user's
 * SSH *private* key, and creating the client certs that will be used to talk
 * to the Triton CMON service.
 *
 * @param {Object} opts: Required.
 *      - {Object} cli: Requried. The Triton CLI object.
 *      - {String} name: Required. The profile name.
 *      - {Boolean} yes: Optional. Boolean indicating if confirmation prompts
 *        should be skipped, assuming a "yes" answer.
 *      - {Number} lifetime: Optional. Number of days to make the CMON
 *        certificate valid for. Defaults to 3650 (10 years).
 */
function profileCmonCertgen(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.optionalBool(opts.yes, 'opts.yes');
    assert.optionalNumber(opts.lifetime, 'opts.lifetime');
    assert.func(cb, 'cb');

    /* Default to a 10 year certificate. */
    if (!opts.lifetime)
        opts.lifetime = DEFAULT_CERT_LIFETIME;

    var cli = opts.cli;
    var tritonapi = cli.tritonapiFromProfileName({profileName: opts.name});

    var log = cli.log;
    var yes = Boolean(opts.yes);

    var profile = tritonapi.profile;
    var cmonHost;

    var agent = new sshpk_agent.Client();
    var sslCert;
    var sslKey;

    vasync.pipeline({arg: {tritonapi: tritonapi}, funcs: [

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

        function checkForCmon(arg, next) {
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
                    if (svcs.cmon) {
                        cmonHost = svcs.cmon;
                        log.trace({cmonHost: cmonHost},
                            'profileCmonSetup: checkForCmonService');
                        next();
                    } else {
                        next(new errors.SetupError(err, format(
                            'no "cmon" service on this datacenter',
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

        function cmonKeyNotice(arg, next) {
            console.log(wordwrap('Note: CMON uses authentication via ' +
                'client TLS certiificates.\n'));
            console.log(wordwrap('This action will create a ' +
                'fresh private key which is written unencrypted to disk ' +
                'in the current working directory. Copy these files to ' +
                'your cmon client (whether Prometheus, or something ' +
                'else).\n'));
            console.log(wordwrap('This key will be usable only for CMON. ' +
                'If your SSH key is removed from your account, this CMON ' +
                'key will no longer work.\n'));
            if (yes) {
                next();
                return;
            } else {
                console.log(wordwrap('If you do not specifically want to use ' +
                    'CMON, or want to set this up later, you can answer ' +
                    '"no" here.\n'));
            }
            common.promptYesNo({msg: 'Continue? [y/n] '}, function (answer) {
                if (answer !== 'y') {
                    console.error('Skipping CMON certificate generation (you ' +
                        'can run "triton profile cmon-certgen" later).');
                    next(true);
                } else {
                    console.log();
                    next();
                }
            });
        },

        function mentionSettingUp(arg, next) {
            console.log('Generating CMON certificates for profile "%s".',
                profile.name);
            next();
        },

        function getSigningKey(arg, next) {
            var keyId = profile.keyId;
            var keyFp = sshpk.parseFingerprint(keyId);
            agent.listKeys(function (err, keys) {
                if (err) {
                    next(err);
                    return;
                }

                arg.certSignKey = keys.filter(function (k) {
                    return (keyFp.matches(k));
                })[0];

                if (!arg.certSignKey) {
                    next(err);
                    return;
                }
                next();
            });
        },

        function generateAndSignCert(arg, next) {
            var certSignKey = arg.certSignKey;

            var account = profile.account;
            if (profile.actAsAccount)
                account = profile.actAsAccount;

            var fp = certSignKey.fingerprint('md5').toString('base64');
            var subj = sshpk.identityFromDN('CN=' + account);
            var issuer = sshpk.identityFromDN('CN=' + fp);

            /*
             * Unlike Docker, where choosing ecdsa is somewhat arbitrary,
             * CMON has severe performance issues with RSA at load. Using
             * ecdsa avoids this.
             */
            sslKey = sshpk.generatePrivateKey('ecdsa');

            var certOpts = {
                lifetime: SECONDS_PER_DAY * opts.lifetime,
                purposes: ['signature', 'identity', 'clientAuth', 'joyentCmon']
            };

            agent.createCertificate(subj, sslKey, issuer, certSignKey,
                certOpts, function (err, cert) {
                    if (err) {
                        next(err);
                        return;
                    }
                    sslCert = cert;
                    next();
            });
        },

        function writeFiles(arg, next) {
            var account = profile.account;
            if (profile.actAsAccount)
                account = profile.actAsAccount;
            var fnStub = 'cmon-' + account;
            fs.writeFileSync(fnStub + '-key.pem', sslKey.toString('pem'));
            fs.writeFileSync(fnStub + '-cert.pem', sslCert.toString('pem'));
            next();
        }
    ]}, function (err) {
        tritonapi.close();

        if (err === true) { // Early-abort signal.
            err = null;
        }
        if (err && !cmonHost) {
            console.error('Warning: Error determining ' +
                'if CloudAPI "%s" provides a CMON service:\n    %s',
                profile.url, err);
            err = null;
        }

        cb(err);
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
 *      - {Boolean} yes: Optional. Boolean indicating if confirmation prompts
 *        should be skipped, assuming a "yes" answer.
 *      - {Number} lifetime: Optional. Number of days to make the Docker
 *        certificate valid for. Defaults to 3650 (10 years).
 */
function profileDockerSetup(opts, cb) {
    assert.object(opts.cli, 'opts.cli');
    assert.string(opts.name, 'opts.name');
    assert.optionalBool(opts.implicit, 'opts.implicit');
    assert.optionalBool(opts.yes, 'opts.yes');
    assert.optionalNumber(opts.lifetime, 'opts.lifetime');
    assert.func(cb, 'cb');

    /* Default to a 10 year certificate. */
    if (!opts.lifetime)
        opts.lifetime = DEFAULT_CERT_LIFETIME;

    var cli = opts.cli;
    var tritonapi = cli.tritonapiFromProfileName({profileName: opts.name});

    var implicit = Boolean(opts.implicit);
    var yes = Boolean(opts.yes);
    var log = cli.log;

    var profile = tritonapi.profile;
    var dockerHost;

    vasync.pipeline({arg: {tritonapi: tritonapi}, funcs: [

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

        function dockerKeyWarning(arg, next) {
            console.log(wordwrap('WARNING: Docker uses authentication via ' +
                'client TLS certificates that do not support encrypted ' +
                '(passphrase protected) keys or SSH agents.\n'));
            console.log(wordwrap('If you continue, this profile setup will ' +
                'create a fresh private key which is written unencrypted to ' +
                'disk in "~/.triton/docker" for use by the Docker client. ' +
                'This key will be useable only for Docker.\n'));
            if (yes) {
                next();
                return;
            } else {
                console.log(wordwrap('If you do not specifically want to use ' +
                    'Docker, you can answer "no" here.\n'));
            }
            common.promptYesNo({msg: 'Continue? [y/n] '}, function (answer) {
                if (answer !== 'y') {
                    console.error('Skipping Docker setup (you can run '
                        + '"triton profile docker-setup" later).');
                    next(true);
                } else {
                    console.log();
                    next();
                }
            });
        },

        function mentionSettingUp(arg, next) {
            console.log('Setting up profile "%s" to use Docker.', profile.name);
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

        function getSigningKey(arg, next) {
            var kr = new auth.KeyRing();
            var profileFp = sshpk.parseFingerprint(profile.keyId);
            kr.findSigningKeyPair(profileFp,
                function unlockAndStash(findErr, keyPair) {

                if (findErr) {
                    next(findErr);
                    return;
                }

                arg.signKeyPair = keyPair;
                if (!keyPair.isLocked()) {
                    next();
                    return;
                }

                common.promptPassphraseUnlockKey({
                    /* Fake the `tritonapi` object, only `.keyPair` is used. */
                    tritonapi: { keyPair: keyPair }
                }, next);
            });
        },
        function generateAndSignCert(arg, next) {
            var key = arg.signKeyPair;
            var pubKey = key.getPublicKey();

            /*
             * There isn't a particular reason this has to be ECDSA, but
             * Docker supports it, and ECDSA keys are much easier to
             * generate from inside node than RSA ones (since sshpk will
             * do them for us instead of us shelling out and mucking with
             * temporary files).
             */
            arg.privKey = sshpk.generatePrivateKey('ecdsa');

            var targetAcct = profile.account;
            if (profile.actAsAccount)
                targetAcct = profile.actAsAccount;
            var id = sshpk.identityFromDN('CN=' + targetAcct);
            var parentId = sshpk.identityFromDN('CN=' +
                pubKey.fingerprint('md5').toString('base64'));
            var serial = crypto.randomBytes(8);
            /*
             * Backdate the certificate by 5 minutes to account for clock
             * sync -- we only allow 5 mins drift in cloudapi generally so
             * using the same amount here seems fine.
             */
            var validFrom = new Date();
            validFrom.setTime(validFrom.getTime() - 300*1000);
            var validUntil = new Date();
            validUntil.setTime(validFrom.getTime() +
                SECONDS_PER_DAY * 1000 * opts.lifetime);
            /*
             * Generate it self-signed for now -- we will clear this
             * signature out and replace it with the real one below.
             */
            var cert = sshpk.createCertificate(id, arg.privKey, parentId,
                arg.privKey, { validFrom: validFrom, validUntil: validUntil,
                purposes: ['clientAuth', 'joyentDocker'], serial: serial });

            var algo = pubKey.type + '-' + pubKey.defaultHashAlgorithm();

            /*
             * This code is using private API in sshpk because there is
             * no public API as of 1.14.x for async signing of certificates.
             *
             * If the sshpk version in package.json is updated (even a
             * patch bump) this code could break! This will be fixed up
             * eventually, but for now we just have to be careful.
             */
            var x509 = require('sshpk/lib/formats/x509');
            cert.signatures = {};
            cert.signatures.x509 = {};
            cert.signatures.x509.algo = algo;
            var signer = key.createSign({
                user: profile.account,
                algorithm: algo
            });
            /*
             * The smartdc-auth KeyPair signer produces an object with
             * strings on it intended for http-signature instead of just a
             * Signature instance (which is what the x509 format module
             * expects). We wrap it up here to convert it.
             */
            var signerConv = function (buf, ccb) {
                signer(buf, function convertSignature(signErr, sigData) {
                    if (signErr) {
                        ccb(signErr);
                        return;
                    }
                    var algparts = sigData.algorithm.split('-');
                    var sig = sshpk.parseSignature(sigData.signature,
                        algparts[0], 'asn1');
                    sig.hashAlgorithm = algparts[1];
                    sig.curve = pubKey.curve;
                    ccb(null, sig);
                });
            };
            /*
             * Sign a "test" string first to double-check the hash algo
             * it's going to use. The SSH agent may not support SHA256
             * signatures, for example, and we will only find out by
             * testing like this.
             */
            signer('test', function afterTestSig(testErr, testSigData) {

                if (testErr) {
                    next(new errors.SetupError(testErr, format(
                        'failed to sign Docker certificate using key ' +
                        '"%s"', profile.keyId)));
                    return;
                }

                cert.signatures.x509.algo = testSigData.algorithm;

                x509.signAsync(cert, signerConv,
                    function afterCertSign(signErr) {

                    if (signErr) {
                        next(new errors.SetupError(signErr, format(
                            'failed to sign Docker certificate using key ' +
                            '"%s"', profile.keyId)));
                        return;
                    }

                    cert.issuerKey = undefined;
                    /* Double-check that it came out ok. */
                    assert.ok(cert.isSignedByKey(pubKey));
                    arg.cert = cert;
                    next();
                });
            });
        },
        function makeClientCertDir(arg, next) {
            arg.dockerCertPath = path.resolve(cli.configDir,
                'docker', common.profileSlug(profile));
            mkdirp(arg.dockerCertPath, next);
        },
        function writeClientCertKey(arg, next) {
            arg.keyPath = path.resolve(arg.dockerCertPath, 'key.pem');
            var data = arg.privKey.toBuffer('pkcs1');
            fs.writeFile(arg.keyPath, data, function (err) {
                if (err) {
                    next(new errors.SetupError(err, format(
                        'error writing file %s', arg.keyPath)));
                } else {
                    next();
                }
            });
        },
        function writeClientCert(arg, next) {
            arg.certPath = path.resolve(arg.dockerCertPath, 'cert.pem');
            var data = arg.cert.toBuffer('pem');

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
            } else if (!semver.parse(arg.dockerVersion) ||
                        semver.gte(arg.dockerVersion, '1.9.0')) {
                // If version isn't valid semver, we are certain it's >= 1.9
                // since all versions of Docker before 1.9 *were*.
                setup.env.COMPOSE_HTTP_TIMEOUT = '300';
            } else {
                setup.env.DOCKER_CLIENT_TIMEOUT = '300';
            }

            fs.writeFile(setupJson,
                JSON.stringify(setup, null, 4) + '\n',
                next);
        },

        function mentionSuccess(arg, next) {
            console.log([
                'Successfully setup profile "%s" to use Docker%s.',
                '',
                'To setup environment variables to use the Docker client, run:',
                '    eval "$(triton env --docker %s)"',
                '    docker%s info',
                'Or you can place the commands in your shell profile, e.g.:',
                '    triton env --docker %s >> ~/.profile'
                ].join('\n'),
                profile.name,
                (arg.dockerVersion ? format(' (v%s)', arg.dockerVersion) : ''),
                profile.name,
                (profile.insecure ? ' --tls' : ''),
                profile.name);
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
    profileCmonCertgen: profileCmonCertgen,
    profileDockerSetup: profileDockerSetup
};
