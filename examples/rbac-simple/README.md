*Caveat*: All `triton rbac ...` support is experimental.

This directly holds a super simple example Triton RBAC Profile for a mythical
"Simple Corp.", with `triton` CLI examples showing how to use it for RBAC.

Our Simple corporation will create an "rbactestsimple" Triton account and
use RBAC to manage its users, roles, etc. It has two users:

- emma: Should have full access, to everything.
- bert: Should only have read access, again to everything.

We want an RBAC config that allows appropriate access for all the employees
and tooling.  Roughly we'll break that into roles as follows:

- Role `admin`. Complete access to the API. Only used by "emma" when, e.g.,
  updating RBAC configuration itself.
- Role `ops`. Full access, except to RBAC configuration updates.
- Role `read`. Read-only access to compute resources.

See "rbac.json" where we encode all this.

The `triton rbac apply` command can work with a JSON config file (and
optionally separate user public ssh key files) to create and maintain a
Triton RBAC configuration. In our example this will be:

    triton rbac apply   # defaults to looking at "./rbac.json"

