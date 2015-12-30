# node-triton changelog

## 4.0.0 (not yet released)

- Add the ability to create a profile copying from an existing profile,
  via `triton profile create --copy NAME`.

- [backwards incompat] #66 `triton profile` now has list, get, etc. sub-commands.
  One backwards incompatible change here is that `triton profile NAME` is
  now `triton profile get NAME`. Note that for bwcompat `triton profiles` is
  a shortcut for `triton profile list`.

- [backwards incompat] #66 `triton image` now has list, get sub-commands.
  One backwards incompatible change here is that `triton image ID|NAME` is
  now `triton image get ID|NAME`. Note that for bwcompat `triton images` is
  a shortcut for `triton image list`.

- [backwards incompat] #66 `triton package` now has list, get sub-commands.
  One backwards incompatible change here is that `triton package ID|NAME` is
  now `triton package get ID|NAME`. Note that for bwcompat `triton packages` is
  a shortcut for `triton package list`.


## 3.6.1 (not yet released)

(nothing yet)


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
