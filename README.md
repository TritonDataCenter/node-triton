# Triton

![logo](https://www.joyent.com/content/01-home/triton-logo.svg)

`triton` is a CLI tool for Joyent's Triton (a.k.a. SmartDataCenter), either for
on-premises installations of Triton or Joyent's Public Cloud
(<https://my.joyent.com>, <http://www.joyent.com/products/compute-service>).

**This project aims to replace
[node-smartdc](https://github.com/joyent/node-smartdc) as both the API
client library for triton ([cloudapi](https://apidocs.joyent.com/cloudapi/))
and the command line tool**

## Installation

1. Install [node.js](http://nodejs.org/).
2. `npm install -g git://github.com/joyent/node-triton`

Verify it installed and is on your PATH:

    $ triton --version
    joyent-triton 1.0.0

## Setup

Before you can use the CLI you'll need a Joyent account, an SSH key uploaded
and `triton` configured with those account details.

1. Create a Joyent Public Cloud account here https://www.joyent.com/public-cloud
2. Upload an SSH key (instructions on the site above)
3. Set the proper environmental variables (instructions also above)

Example environmental variables

    SDC_URL=https://us-east-3b.api.joyent.com
    SDC_ACCOUNT=dave.eddy@joyent.com
    SDC_KEY_ID=04:0c:22:25:c9:85:d8:e4:fa:27:0d:67:94:68:9e:e9

## Example

List instances

    $ triton instances
    SHORTID  NAME  IMG  STATE  PRIMARYIP  AGO

We have no instances created yet, so let's create some.  In order to create
an instance we need to specify two things: an image and a package.  An image
represents what will be used as the root of the instances filesystem, and the
package represents the size of the instance, eg. ram, disk size, cpu shares,
etc.  More information on images and packages below - for now we'll just use
a basic combo of SmartOS 64bit and a small 128M ram package.


### XXX 1. show create, 2. show instances again, 3. show ssh'ing in, 4. explain images and packages

Get a quick overview of your account

    $ triton info
    login: dave.eddy@joyent.com
    name: Dave Eddy
    email: dave.eddy@joyent.com
    url: https://us-east-3b.api.joyent.com
    totalDisk: 8.5 GiB
    totalMemory: 366.2 MiB
    instances: 3
        running: 2
        stopped: 1

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


## Bash completion

You can quickly source `triton` bash completions in your current
shell with:

    source <(triton completion)

For a more permanent installation:

    triton completion >> ~/.bashrc

    # Or maybe:
    triton completion > /usr/local/etc/bash_completion.d/triton


## node-triton differences with node-smartdc

- There is a single `triton` command instead of a number of `sdc-*` commands.
- The `SDC_USER` envvar is accepted in preference to `SDC_ACCOUNT`.


## cloudapi2.js differences with node-smartdc/lib/cloudapi.js

The old node-smartdc module included an lib for talking directly to the SDC
Cloud API (node-smartdc/lib/cloudapi.js). Part of this module (node-triton) is a
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


## Development Hooks

Before commiting be sure to:

    make check      # lint and style checks
    make test       # run unit tests

A good way to do that is to install the stock pre-commit hook in your
clone via:

    make git-hooks

## License

MPL 2.0
