# node-triton changelog

## 3.0.0 (not yet released)

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
    - `triton rbac info` will dump a summary of the full current RBAC
      configuration. This command is still in development.
    - `triton rbac {instance,image,network,package,}role-tags ...` to list 
      and manage role tags on each of those resources.
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
