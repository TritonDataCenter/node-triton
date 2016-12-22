# node-triton changelog

Known issues:

- `triton ssh ...` disables ssh ControlMaster to avoid issue #52.


## not yet released

- [joyent/node-triton#156] Providing all required profile options as
  command line flags (account, url, keyId) no longer produces an
  incomplete profile error.

- PUBAPI-1171/PUBAPI-1205/PUBAPI-1351 The handling of legacy `SDC_*`
  environment variables has been cleaned up.  These environment
  variables are used for compatibility with the node-smartdc toolset.
   * `SDC_TESTING` is now evaluated the same way as node-smartdc.  Any
     set value but the empty string is true.
   * Errors on boolean environment variables will now identify the
     variable at fault.
   * `triton env` will emit additional comments grouping variables.

- [joyent/node-triton#80] Add `triton network list public=true|false`
  filtering. Note that this filtering is client-side.

- [joyent/node-triton#146] Add `--wait` flag to `triton instance rename`.

- [joyent/node-triton#133] Add `triton inst fwrule list` and `triton fwrules` shortcuts
  for the existing `triton inst fwrules` and `triton fwrule list`, respectively.

- [joyent/node-triton#3] triton ssh command not aware of "ubuntu" login for ubuntu-certified images

- [joyent/node-triton#137] Improve the handling for the getting started case
  when a user may not have envvars or a profile setup.

- [joyent/node-triton#158] tritonapi image cache never expires

- [joyent/node-triton#153] Bump restify-clients dep. Thanks, github.com/tomgco.

- [joyent/node-triton#154] Fix `triton cloudapi ...` after #108 changes.

- **BREAKING CHANGE for module usage of node-triton.**
  To implement joyent/node-triton#108, the way a TritonApi client is
  setup for use has changed from being (unrealistically) sync to async.

  Client preparation is now a multi-step process:

  1. create the client object;
  2. initialize it (mainly involves finding the SSH key identified by the
     `keyId`); and,
  3. optionally unlock the SSH key (if it is passphrase-protected and not in
     an ssh-agent).

  `createClient` has changed to take a callback argument. It will create and
  init the client (steps 1 and 2) and takes an optional `unlockKeyFn` parameter
  to handle step 3. A new `mod_triton.promptPassphraseUnlockKey` export can be
  used for `unlockKeyFn` for command-line tools to handle prompting for a
  passphrase on stdin, if required. Therefore what used to be:

        var mod_triton = require('triton');
        try {
            var client = mod_triton.createClient({      # No longer works.
                profileName: 'env'
            });
        } catch (initErr) {
            // handle err
        }

        // use `client`

  is now:

        var mod_triton = require('triton');
        mod_triton.createClient({
            profileName: 'env',
            unlockKeyFn: triton.promptPassphraseUnlockKey
        }, function (err, client) {
            if (err) {
                // handle err
            }

            // use `client`
        });

  See [the examples/ directory](examples/) for more complete examples.

  Low-level/raw handling of the three steps above is possible as follows
  (error handling is elided):

        var mod_bunyan = require('bunyan');
        var mod_triton = require('triton');

        // 1. create
        var client = mod_triton.createTritonApiClient({
            log: mod_bunyan.createLogger({name: 'my-tool'}),
            config: {},
            profile: mod_triton.loadProfile('env')
        });

        // 2. init
        client.init(function (initErr) {
            // 3. unlock key
            // See top-comment in "lib/tritonapi.js".
        });

- [joyent/node-triton#108] Support for passphrase-protected private keys.
  Before this work, an encrypted private SSH key (i.e. protected by a
  passphrase) would have to be loaded in an ssh-agent for the `triton`
  CLI to use it. Now `triton` will prompt for the passphrase to unlock
  the private key (in memory), if needed. For example:

        $ triton package list
        Enter passphrase for id_rsa:
        SHORTID   NAME             MEMORY  SWAP  DISK  VCPUS
        14ad9d54  g4-highcpu-128M    128M  512M    3G      -
        14ae2634  g4-highcpu-256M    256M    1G    5G      -
        ...

- [joyent/node-triton#143] Fix duplicate output from 'triton rbac key ...'.

## 4.15.0

- [joyent/node-triton#64] Support 'triton instance rename ...' (by
  github.com/YangYong3).
- [trentm/node-dashdash#30, joyent/node-triton#144] Change the output used by
  Bash completion support to indicate "there are no completions for this
  argument" to cope with different sorting rules on different Bash/platforms.
  For example:

        $ triton -p test2 package get <TAB>          # before
        ##-no -tritonpackage- completions-##

        $ triton -p test2 package get <TAB>          # after
        ##-no-completion- -results-##

## 4.14.2

- TOOLS-1592 First workaround for a possible BadDigestError when using
  node v6.

## 4.14.1

- TOOLS-1587 'triton profile docker-setup' fails when path to 'docker' has
  spaces. This can help on Windows where Docker Toolbox installs docker.exe
  to "C:\Program Files\Docker Toolbox".
- [#136] bash completion for `triton profile create --copy <TAB>`

## 4.14.0

- [#130] Include disabled images when using an image cache (e.g. for filling in
  image name and version details in `triton ls` output.


## 4.13.0

- [#120] Don't fail `triton instance list` if the retrieval of *image* info
  (retrieved to get image name and version, as a bonus) fails with an
  authorization error -- in case it is an RBAC failure where a subuser can
  ListMachines, but not ListImages.

- [#113] *Usage* errors now some "error help", including option or command
  synopses. Some examples (the new thing is marked with `>`):

  - Command synopses when argument errors:

    ```
        $ triton create
        triton instance create: error (Usage): incorrect number of args
    >   usage: triton instance create [OPTIONS] IMAGE PACKAGE
    ```

  - Option synopsis with option errors:

    ```
        $ triton image ls --bogus
        triton image ls: error (Option): unknown option: "--bogus"
    >   usage: triton image ls [ --help | -h ] [ --all | -a ] [ -H ] [ -o field1,... ]
    >       [ --long | -l ] [ -s field1,... ] [ --json | -j ] ...
    ```

  - Suggested command name misspellings:

    ```
        $ triton in
        triton: error (UnknownCommand): unknown command: "in"
    >   Did you mean this?
    >       info
    >       inst
    ```


## 4.12.0

- [#120] `triton -r,--role ROLE ...` option to take up an RBAC role(s).


## 4.11.0

- [#112] Fix `triton completion`, broke a while back.
- [#111] `triton env --unset,-u` option to emit environment commands to *unset*
  relevant envvars.
- Unhide `triton env` from `triton --help` output.


## 4.10.0

- [#82] Affinity (a.k.a. locality hints) support for instance creation, e.g.:

        # Use same server as instance 'db0':
        triton create -a instance==db0 ...
        triton create -a db0 ...           # shortcut for same thing

        # Use different server than instance 'db0':
        triton create -a 'instance!=db0' ...

        # *Attempt* to use same server as instance 'db0', but don't fail
        # if cannot. This is called a "non-strict" or "soft" rule.
        triton create -a instance==~db0 ...

        # *Attempt* to use a different server than instance 'db0':
        triton create -a 'instance!=~db0' ...

  "Affinity" here refers to providing rules for deciding on which server
  a new instance should by provisioned. Rules are in terms of existing
  instances. As a shortcut, 'inst' can be used in place of 'instance'
  above (e.g. `triton create -a 'inst!=db0' ...`).

## 4.9.0

- [#46] Initial support for `triton` helping setup and manage configuration for
  using `docker` against a Triton datacenter. Triton datacenters can provide
  a Docker Remote API endpoint against which you can run the normal `docker`
  client. See <https://www.joyent.com/triton> for and overview and
  <https://github.com/joyent/sdc-docker> for developer details.

  - `triton profile create` will now setup the profile for running Docker,
    if the Triton datacenter provides a docker endpoint. The typical flow
    would be:

        $ triton profile create
        name: foo
        ...
        $ triton profile set foo            # make foo my default profile
        $ eval "$(triton env --docker)"     # set 'DOCKER_' envvars
        $ docker info

    This profile setup for Docker requires making requests to the
    CloudAPI endpoint which can fail (e.g. if CloudAPI is down, credentials
    are invalid, etc.). You can use the `--no-docker` option to skip
    the Docker setup part of profile creation.

  - For existing Triton CLI profiles, there is a new `triton profile
    docker-setup [PROFILE]`.

        $ triton profile docker-setup
        $ eval "$(triton env --docker)"
        $ docker info

  - `triton env` will now emit commands to setup `DOCKER_` envvars. That
    can be limited to just the Docker-relevant env via `triton env --docker`.


## 4.8.0

- #103 `triton ip <inst>` to output the instance's primaryIp
- #52 Workaround for `triton ssh ...`. In version 4.6.0, `triton ssh ...`
  interactive sessions were broken. This version reverts that change and adds
  a workaround for #52 (by disabling ControlMaster when spawning `ssh`).
  See <https://github.com/joyent/node-triton/issues/52> for details.
- #97 `triton profile set -` to set the *last* profile as current.
- PUBAPI-1266 Added `instance enable-firewall` and `instance disable-firewall`


## 4.7.0

**Known issue: `triton ssh` interactive sessions are broken.
Upgrade to v4.7.1.**

- #101 Bash completion for server-side data: instances, images, etc.
  Bash completion on TAB should now work for things like the following:
  `triton create <TAB to complete images> <TAB to complete packages`,
  `triton inst tag ls <TAB to complete instances>`. Cached (with a 5 minute
  TTL) completions for the following data are supported: instances, images,
  packages, networks, fwrules, account keys.
  See `triton completion --help` for adding/updating Bash completion.
- #99 `triton profile set ...` alias for `set-current`


## 4.6.0

**Known issue: `triton ssh` interactive sessions are broken.
Upgrade to v4.7.1.**

- #98 `triton inst get ID` for a deleted instance will now emit the instance
  object and error less obtusely. This adds a new `InstanceDeleted` error code
  from `TritonApi`.
- PUBAPI-1233 firewalls: `triton fwrule ...`
- PUBAPI-1234 instance snapshots: `triton inst snapshot ...`
- #52 Fix 'triton ssh ...' stdout/stderr to fully flush with node >= 4.x.


## 4.5.2

- #95 Fix breakage of `triton image create` in v4.5.0. (By Kris Shannon.)
- #94, #93 `triton inst create ...` is broken if "images.json" cache file
  is missing. (By Kris Shannon.)


## 4.5.1

- #92 `triton` CLI should summarize `err.body.errors` from CloudAPI
  Per <https://github.com/joyent/eng/blob/master/docs/index.md#error-handling>,
  CloudAPI error response will sometimes have extra error details to show.


## 4.5.0

- #88 'triton inst tag ...' for managing instance tags.


## 4.4.4

- #90 Update sshpk and smartdc-auth to attempt to deal with multiple package
  inter-deps.


## 4.4.3

- #86 Ensure `triton profile ls` and `triton profile set-current` work
  when there is no current profile.


## 4.4.2

- Support `triton.createClient(...)` creation without requiring a
  `configDir`. Basically this then fallsback to a `TritonApi` with the default
  config.


## 4.4.1

- #83, #84 Fix running `triton` on Windows.
  Note: Triton config is stored in "%APPDATA%/Joyent/Triton/..." on Windows,
  "~/.triton/..." on other platforms.


## 4.4.0

- #78 `triton image delete IMAGE`
- #79 Fix `triton instance get NAME` to make sure it gets the `dns_names` CNS
  field.
- PUBAPI-1227: Note that `triton image list` doesn't include Docker images, at
  least currently.


## 4.3.1

- #77 triton create error in v4.3.0


## 4.3.0

**Bad release. Use >=4.3.1.**

- #76 `triton image create ...` and `triton image wait ...`
- #72 want `triton image` to still return image details even when it is not in 'active' state


## 4.2.0

- Bash completion: Add completion for *args* to `triton account update <TAB>`.
  This isn't perfect because a space is added after completion of "FIELD=",
  but hopefully is helpful.
- #75 `triton account update ...`


## 4.1.0

- Unhide `triton completion` so hopefully more find it and use it.

- node-triton#73 `triton instance list --credentials` to include
  "metadata.credentials" in instance listing.

- node-triton#35 More easily distinguish KVM and LX and Docker images and
  instances.

    In PUBAPI-1161 CloudAPI (v8.0.0) started exposing IMG.type, INST.brand and
    INST.docker. One of the main issues for users is that telling KVM ubuntu
    from LX ubuntu is confusing (see also joyent/smartos-live#532).

    tl;dr:

    - `triton image list` default output now includes the `type` instead of
      `state`. The `state` column is still in output with `-l`, `-j`,
      `-o state`.
    - `triton instance list` default output now includes a `flags` column
      instead of `primaryIp`. The 'D' and 'K' flags identify Docker and KVM
      instances.
    - `triton instance list -l` includes the brand.

    Default output examples showing the various cases (and the attempt to
    stay within 80 columns):

    ```bash
    $ triton imgs
    SHORTID   NAME            VERSION   FLAGS  OS       TYPE          PUBDATE
    1bd84670  minimal-64-lts  14.4.2    P      smartos  zone-dataset  2015-05-28
    b67492c2  base-64-lts     14.4.2    P      smartos  zone-dataset  2015-05-28
    ffe82a0a  ubuntu-15.04    20151105  P      linux    lx-dataset    2015-11-05
    8a1dbc62  centos-6        20160111  P      linux    zvol          2016-01-11

    $ triton insts
    SHORTID   NAME         IMG                    STATE    FLAGS  AGE
    da7c6edd  cocky_noyce  3d996aaa               running  DF     10m
    deedeb42  ubu0         ubuntu-15.04@20151105  running  -      9m
    aa9ccfda  mini2        minimal-64-lts@14.4.2  running  -      9m
    e8fc0b96  centi0       centos-6@20160111      running  K      8m
    ```

- Filtering instances on `docker=true`:

    ```bash
    $ triton insts docker=true
    SHORTID   NAME         IMG       STATE    FLAGS  AGE
    da7c6edd  cocky_noyce  3d996aaa  running  DF     13m
    ```


## 4.0.1

- Add `triton env -t` to be able to emit a shell environment to configure `triton` itself.
  This allows one to have the following Bash function to select a Triton profile for
  `triton` and node-smartdc tooling:

        function triton-select { eval $(triton env $1); }


## 4.0.0

- [backwards incompat] #66 New consistent `triton` CLI style. See [the
  issue](https://github.com/joyent/node-triton/issues/66) for discussion.

    The major changes is that where some sub-commands used to be some
    flavour of:

        triton things       # list all the things
        triton thing ID     # get a thing
        triton thing -a ID  # create a new thing

    Now commands are consistently:

        triton thing list       # list all the things
        triton thing get ID     # get a thing
        triton thing create ... # create a new thing
        ...

    The most annoying incompatility is the need for "get" to
    get a thing. E.g.:

        BEFORE                  AFTER
        triton img blah         triton img get blah
        triton inst web0        triton inst get web0

    For *listing* things, there is typically a shortcut with
    the old form, e.g. `triton images` is a shortcut for
    `triton image list`.

    Currently all of the CLI *except* the experimental `triton rbac ...`
    is converted to the new consistent style.

- [backwards incompat] `triton whoami` was dropped. This used to be a shortcut
  for `triton account get`. It could possibly come back.

- *Much* improved [Bash
  completion](https://github.com/joyent/node-triton#bash-completion). See
  `triton completion -h` for notes on how to install.

- Add the ability to create a profile copying from an existing profile,
  via `triton profile create --copy NAME`.

- `triton key add` was added (<https://apidocs.joyent.com/cloudapi/#CreateKey>).


## 3.6.0

- #67 Add `triton create --network,-N NETWORK ...` option for specifying
  networks for instance creation. "NETWORK" is a network id, name, or
  short id; or a comma-separated array of networks.


## 3.5.0

- #67 Add `triton create --tag|-t ...` option for adding tags on instance creation.
  E.g. `triton create -n NAME -t foo=bar -t @my-tags-file.json IMAGE PACKAGE`.


## 3.4.2

- #63 "triton images" with a filter should not be cached.
- #65 Fix `triton profile(s)` handling when the user has no profiles yet.


## 3.4.1

- #60 Display `vcpus` in `triton packages` output.
- Add `-d,--data <data>` option to `triton cloudapi`.
- Fix `triton rbac role ROLE`. Also get that command to have a stable order for the
  displayed fields.


## 3.4.0

- Improvements for using node-triton as a module. E.g. a simple example:

        var triton = require('triton');
        var client = triton.createClient({profileName: 'env'});
        client.listImages(function (err, imgs) {
            console.log(err);
            console.log(imgs);
        });

  See the README and "lib/index.js" for more info.


## 3.3.0

- #59 CLI options to `triton create` to add metadata on instance creation:
    - `triton create -m,--metadata KEY=VALUE` to add a single value
    - `triton create -m,--metadata @FILE` to add values from a JSON
      or key/value-per-line file
    - `triton create -M,--metadata-file KEY=FILE` to set a key from a file
    - `triton create --script FILE` to set the special "user-script" key
      from a file


## 3.2.0

- #58 `triton --act-as=ACCOUNT ...` for an operator account to auth as
  themself, but operator on another account's resources. Note that operator
  accesses like this are audited on the CloudAPI server side.
- `triton --accept-version VER` hidden top-level option for development. This
  allows calling the target cloudapi with the given value for the
  "Accept-Version" header -- which is how CloudAPI does API versioning.
  By default `triton` is coded to a particular cloudapi version range, so
  forcing a different version *could* result in breaking in the triton client
  code that handles the response. IOW, this is just a tool for developers
  of this Triton client and CloudAPI itself.


## 3.1.0

- New (hidden for now, i.e. experimental) `triton env ...` to dump
  `eval`able shell commands for
  [node-smartdc](https://github.com/joyent/node-smartdc) environment setup for
  a given Triton CLI profile. E.g.:

        eval $(triton env east1)
        sdc-listmachines

  I think this should grow to support setting up Docker env as well.
- #54 `triton rbac role-tags` for now can't be hidden (as long we have the
  need to role-tag raw resource URLs like '/my/images').
- #54 `triton rbac apply --dev-create-keys-and-profiles` for
  experimenting/dev/testing to quickly generate and add user keys and setup
  Triton CLI profiles for all users in the RBAC config.
- #54 RBAC support, see <https://docs.joyent.com/public-cloud/rbac> to start.
    - `triton rbac info` improvements: better help, use brackets to show
      non-default roles.
    - `triton rbac reset`
    - change `triton rbac user USER` output a little for the 'keys' (show
      the key fingerprint and name instead of the key content), 'roles',
      and 'default_roles' fields.
- #54 *Drop* support for shortIds for `triton rbac {users,roles,policies}`
  commands. They all have unique *`name`* fields, just use that.
- #54 `triton rbac apply` will implicitly look for a user key file at
  "./rbac-user-keys/$login.pub" if no `keys` field is provided in the
  "rbac.json" config file.
- Change default `triton keys` and `triton rbac keys` output to be tabular.
  Otherwise it is a little obtuse to see fingerprints (which is what currently
  must be included in a profile). `triton [rbac] keys -A` can be used to
  get the old behaviour (just the key content, i.e. output appropriate
  for "~/.ssh/authorized\_keys").


## 3.0.0

- #54 RBAC support, see <https://docs.joyent.com/public-cloud/rbac> to start.
    - [Backward incompatible.] The `triton` CLI option for the cloudapi URL has
      changed from `--url,-u` to **`--url,-U`**.
    - Add `triton --user,-u USER` CLI option and `TRITON_USER` (or `SDC_USER`)
      environment variable support for specifying the RBAC user.
    - `triton profiles` now shows the optional `user` fields.
    - A (currently experimental and hidden) `triton rbac ...` command to
      house RBAC CLI functionality.
    - `triton rbac users` to list all users.
    - `triton rbac user ...` to show, create, edit and delete users.
    - `triton rbac roles` to list all roles.
    - `triton rbac role ...` to show, create, edit and delete roles.
    - `triton rbac policies` to list all policies.
    - `triton rbac policy ...` to show, create, edit and delete policies.
    - `triton rbac keys` to list all RBAC user SSH keys.
    - `triton rbac key ...` to show, create, edit and delete user keys.
    - `triton rbac {instance,image,network,package,}role-tags ...` to list
      and manage role tags on each of those resources.
    - `triton rbac info` will dump a summary of the full current RBAC
      state. This command is still in development.
    - `triton rbac apply` will synchronize a local RBAC config (by default it
      looks for "./rbac.json") to live RBAC state. Current the RBAC config
      file format is undocumented. See "examples/rbac-\*" for examples.
- #55 Update of smartdc-auth/sshpk deps, removal of duplicated code for
  composing Authorization headers


## 2.1.4

- #51: Update deps to get dtrace-provider 0.6 build fix for node v4.2.x.
- #49: `triton create ... --firewall` to enable [Cloud
  Firewall](https://docs.joyent.com/public-cloud/network/firewall).


## 2.1.3

- #44 'triton rm' alias for delete
- #43 `triton profile ...` doesn't use the profile from `TRITON_PROFILE` envvar

## 2.1.2

- #41 Add compatibility with ed25519 keys in ssh-agent
- #42 Tools using sshpk should lock in an exact version

## 2.1.1

- #40 Update smartdc-auth so that newer OpenSSH `ssh-keygen` default
  fingerprint formats for setting `keyId` work.
- #39 Test suite: Change the test config 'destructiveAllowed' var to
  'writeActionsAllowed'.


## 2.1.0

- Errors and exit status: Change `Usage` errors to always have an exit status
  of `2` (per common practice in at least some tooling). Add `ResourceNotFound`
  error for `triton {instance,package,image,network}` with exit status `3`.
  This can help tooling (e.g. the test suite uses this in one place). Add
  `triton help` docs on exit status.

- Test suite: Integration tests always require a config file
  (either `$TRITON_TEST_CONFIG` path or "test/config.json").
  Drop the other `TRITON_TEST_*` envvars.


## 2.0.0

- Changed name to `triton` npm package, graciously given up by
  [suguru](https://www.npmjs.com/~suguru) from his
  <https://github.com/ameba-proteus/node-triton> project. <3
  The latest previous release of the triton package was 1.0.7,
  so we'll separate with a major version bump for *this* triton
  package.

## 1.0.0

Initial release as `joyent-triton` npm package.
