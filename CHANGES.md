# node-triton changelog

## 2.1.3 (not yet released)

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
