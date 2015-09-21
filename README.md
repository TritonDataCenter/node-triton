![logo](./tools/triton-text.svg)

# node-triton

`triton` is a CLI tool for working with the CloudAPI for Joyent's Triton [Public Cloud]
(https://docs.joyent.com/public-cloud) and [Private Cloud] (https://docs.joyent.com/private-cloud).
CloudAPI is a RESTful API for end users of the cloud to manage their accounts, instances,
networks, images, and to inquire other relevant details. CloudAPI provides a single view of
docker containers, infrastructure containers and hardware virtual machines available in the
Triton solution.

There is currently another CLI tool known as [node-smartdc](https://github.com/joyent/node-smartdc)
for CloudAPI. `node-smartdc` CLI works off the 32-character object UUID to uniquely
identify object instances in API requests, and returns response payload in JSON format.
The CLI covers both basic and advanced usage of [CloudAPI](https://apidocs.joyent.com/cloudapi/).

As a lightweight programmable interface for CloudAPI, the `triton` CLI supports both name or
UUID identification of object instances and the use of short ID, as well as the choice
between concise tabular responses and full JSON responses. **The `triton` CLI is currently in
beta and will be expanded over time to support all CloudAPI commands, eventually replacing
`node-smartdc` as both the API client library for Triton cloud and the command line tool.**

## Setup

### User accounts, authentication, and security

Before you can use the CLI you'll need an account on the cloud to which you are connecting and
an SSH key uploaded. The SSH key is used to identify and secure SSH access to containers and
other resources in Triton.

If you do not already have an account on Joyent Public Cloud, sign up [here](https://www.joyent.com/public-cloud).


### API endpoint

Each data center has a single CloudAPI endpoint. For Joyent Public Cloud, you can find the
list of datacenters [here](https://docs.joyent.com/public-cloud/api-access/cloudapi#datacenter-urls).
For private cloud implementations, please consult the private cloud operator for the correct URL.
Have the URL handy as you'll need it in the next step.


### Installation

1. Install [node.js](http://nodejs.org/).
2. `npm install -g git://github.com/joyent/node-triton`

Verify that it is installed and on your PATH:

    $ triton --version
    Triton CLI 1.0.0

Configure the proper environmental variables that correspond to the API endpoint and account,
for example:

    SDC_URL=https://us-east-3b.api.joyent.com
    SDC_ACCOUNT=dave.eddy@joyent.com
    SDC_KEY_ID=04:0c:22:25:c9:85:d8:e4:fa:27:0d:67:94:68:9e:e9


### Bash completion

You can quickly source `triton` bash completions in your current
shell with:

    source <(triton completion)

For a more permanent installation:

    triton completion >> ~/.bashrc

    # Or maybe:
    triton completion > /usr/local/etc/bash_completion.d/triton


## Examples

### Create and view instances

    $ triton instances
    SHORTID  NAME  IMG  STATE  PRIMARYIP  AGO

We have no instances created yet, so let's create some.  In order to create
an instance we need to specify two things: an image and a package.  An image
represents what will be used as the root of the instances filesystem, and the
package represents the size of the instance, eg. ram, disk size, cpu shares,
etc.  More information on images and packages below - for now we'll just use
SmartOS 64bit and a small 128M ram package which is a combo available on the
Joyent Public Cloud.

    $ triton create-instance base-64 t4-standard-128M

Without a name specified, the container created will have a generated ID. Now
to create a container-native Ubuntu 14.04 container with 2GB of ram with the
name "server-1"

    $ triton create-instance --name=server-1 ubuntu-14.04 t4-standard-2G

Now list your instances again

    $ triton instances
    SHORTID   NAME      IMG                     STATE         PRIMARYIP        AGO
    7db6c907  b851ba9   base-64@15.2.0          running       165.225.169.63   9m
    9cf1f427  server-1  ubuntu-14.04@20150819   provisioning  -                0s


Get a quick overview of your account

    $ triton info
    login: dave.eddy@joyent.com
    name: Dave Eddy
    email: dave.eddy@joyent.com
    url: https://us-east-3b.api.joyent.com
    totalDisk: 50.5 GiB
    totalMemory: 2.0 MiB
    instances: 2
        running: 1
        provisioning: 1

To obtain more detailed information of your instance

    $ triton instance server-1
    {
        "id": "9cf1f427-9a40-c188-ce87-fd0c4a5a2c2c",
        "name": "251d4fd",
        "type": "smartmachine",
        "state": "running",
        "image": "c8d68a9e-4682-11e5-9450-4f4fadd0936d",
        "ips": [
            "165.225.169.54",
            "192.168.128.16"
        ],
        "memory": 2048,
        "disk": 51200,
        "metadata": {
            "root_authorized_keys": "(...ssh keys...)"
        },
        "tags": {},
        "created": "2015-09-08T04:56:27.734Z",
        "updated": "2015-09-08T04:56:43.000Z",
        "networks": [
            "feb7b2c5-0063-42f0-a4e6-b812917397f7",
            "726379ac-358b-4fb4-bb7c-8bc4548bac1e"
        ],
        "dataset": "c8d68a9e-4682-11e5-9450-4f4fadd0936d",
        "primaryIp": "165.225.169.54",
        "firewall_enabled": false,
        "compute_node": "44454c4c-5400-1034-8053-b5c04f383432",
        "package": "t4-standard-2G"
    }


### SSH to an instance

Connect to an instance over SSH

    $ triton ssh b851ba9
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

    $ triton ssh b851ba9 uname -v
    joyent_20150826T120743Z


### Manage an instance

Commonly used container operations are supported in the Triton CLI.
More operations will be added to the list over time.

    $ triton help
    ...
    instance-audit            List instance actions.
    start-instance (start)    Start a single instance.
    stop-instance (stop)      Stop a single instance.
    reboot-instance (reboot)  Reboot a single instance.
    delete-instance (delete)  Delete a single instance.
    wait-instance (wait)      Wait on instances changing state.
    ...

### View packages and images

Package definitions and images available vary between different datacenters
and different Triton cloud implementations.

To see all the packages offered in the datacenter and specific package information, use

    $ triton packages
    $ triton package ID|NAME

Similarly, to find out the available images and their details, do

    $ triton images
    $ triton image ID|NAME

Note that docker images are not shown in `triton images` as they are
maintained in Docker Hub and other third-party registries configured to be
used with Joyent's Triton clouds. **In general, docker containers should be
provisioned and managed with the regular [`docker` CLI](https://docs.docker.com/installation/#installation)**
(Triton provides an endpoint that represents the _entire datacenter_
as a single `DOCKER_HOST`. See the [Triton Docker
documentation](https://apidocs.joyent.com/docker) for more information.)


## Configuration

This section defines all the vars in a TritonApi config. The baked in defaults
are in "etc/defaults.json" and can be overriden for the CLI in
"~/.triton/config.json".

| Name | Description |
| ---- | ----------- |
| profile | The name of the triton profile to use. The default with the CLI is "env", i.e. take config from `SDC_*` envvars. |
| cacheDir | The path (relative to the config dir, "~/.triton") where cache data is stored. The default is "cache", i.e. the `triton` CLI caches at "~/.triton/cache". |


## node-triton differences with node-smartdc

- There is a single `triton` command instead of a number of `sdc-*` commands.
- The `SDC_USER` env variable is accepted in preference to `SDC_ACCOUNT`.


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
