Triton
======

`triton` is a tool for Joyent's Triton (a.k.a. SmartDataCenter), either for on-premises installations
of Triton or Joyent's Public Cloud (<https://my.joyent.com>,
<http://www.joyent.com/products/compute-service>).

**This project is experimental and probably broken. For now, please look
at [node-smartdc](https://github.com/joyent/node-smartdc).**

Installation
------------

1. Install [node.js](http://nodejs.org/).
2. `npm install -g git://github.com/joyent/node-triton`

Verify that installed and is on your PATH:

    $ triton --version
    Triton client 1.0.0

Before you can used the CLI you'll need a Joyent account, an SSH key uploaded
and `triton` configured with those account details.

Setup
-----

TODO

Example
-------

Get a quick overview of your account

    $ triton info
    dave.eddy@joyent.com - Dave Eddy <dave.eddy@joyent.com>
    https://us-east-3b.api.joyent.com

    5 instance(s)
    - 1 stopped
    - 4 running
    - 610.3 MiB RAM Total
    - 14.3 GiB Disk Total

See running instances

    $ triton instances
    ID                                    NAME       STATE    TYPE          IMG                                   MEMORY  DISK  AGO
    908a781b-e4c8-4291-dcf5-b0fcbcc0cb8a  machine-1  stopped  smartmachine  5c7d0d24-3475-11e5-8e67-27953a8b237e  128     3072  2h
    7807f369-79eb-ebe9-85f6-db3017a75f0f  machine-2  running  smartmachine  5c7d0d24-3475-11e5-8e67-27953a8b237e  128     3072  2h
    a2d537b4-feb1-c530-f1ff-e034eb73adaa  machine-3  running  smartmachine  5c7d0d24-3475-11e5-8e67-27953a8b237e  128     3072  2h
    7db6c907-2693-42bc-ea9b-f38678f2554b  machine-4  running  smartmachine  5c7d0d24-3475-11e5-8e67-27953a8b237e  128     3072  2h
    8892b12f-60e9-c4ba-f0f8-a4ca9714ea9c  machine-5  running  smartmachine  5c7d0d24-3475-11e5-8e67-27953a8b237e  128     3072  2h

Connect to an instance over SSH

    $ triton ssh machine-4
    Last login: Wed Aug 26 17:59:35 2015 from 208.184.5.170
       __        .                   .
     _|  |_      | .-. .  . .-. :--. |-
    |_    _|     ;|   ||  |(.-' |  | |
      |__|   `--'  `-' `;-| `-' '  ' `-'
                       /  ; Instance (base-64 15.2.0)
                       `-'  https://docs.joyent.com/images/smartos/base

    [root@7db6c907-2693-42bc-ea9b-f38678f2554b ~]# uptime
     20:08pm  up   2:27,  0 users,  load average: 0.00, 0.00, 0.01
    [root@7db6c907-2693-42bc-ea9b-f38678f2554b ~]# logout
    Connection to 165.225.169.63 closed.

Or non-interactively

    $ triton ssh machine-4 uname -v
    joyent_20150826T120743Z


### node-triton differences with node-smartdc

- There is a single `sdc` command instead of a number of `sdc-FOO` commands.
- The `SDC_USER` envvar is accepted in preference to `SDC_ACCOUNT`.


### cloudapi2.js differences with node-smartdc/lib/cloudapi.js

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
