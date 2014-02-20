`sdc` is a CLI for Joyent SmartDataCenter and the
Joyent Public Cloud (<https://my.joyentcloud.com>,
<http://www.joyent.com/products/compute-service>).

# Installation

1. Install [node.js](http://nodejs.org/).
2. `npm install -g sdc`

Verify that installed and is on your PATH:

    $ sdc --version
    sdc CLI 1.0.0

Before you can used the CLI you'll need a Joyent account, an SSH key uploaded
and `sdc` configured with those account details.

# Setup

TODO

# Getting Started

TODO


# node-sdc differences with node-smartdc

- There is a single `sdc` command instead of a number of `sdc-FOO` commands.
- The `SDC_USER` envvar is accepted in preference to `SDC_ACCOUNT`.


# cloudapi2.js differences with node-smartdc/lib/cloudapi.js

The old node-smartdc module included an lib for talking directly to the SDC
Cloud API (node-smartdc/lib/cloudapi.js). Part of this module (node-sdc) is a
re-write of the Cloud API lib with some backward incompatibilities. The
differences and backward incompatibilities are discussed here.

- Currently no caching options in cloudapi2.js (this should be re-added in
  some form). The `noCache` option to many of the cloudapi.js methods will not
  be re-added, it was a wart.
- The leading `account` option to each cloudapi.js method has been dropped. It
  was redundant for the constructor `account` option.
- "account" is now "user" in the CloudAPI constructor.
- All (all? at least at the time of this writing) methods in cloudapi2.js have
  a signature of `function (options, callback)` instead of the sometimes
  haphazard extra arguments.

