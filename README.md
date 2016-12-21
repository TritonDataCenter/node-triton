![logo](./tools/triton-text.png)

# node-triton

This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md) --
*Triton does not use GitHub PRs* -- and general documentation at the main
[Triton project](https://github.com/joyent/triton) page.

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

**The `triton` CLI is currently in beta (effectively because it does not yet
have *complete* coverage of all commands from node-smartdc) and will be
expanded over time to support all CloudAPI commands, eventually replacing
`node-smartdc` as both the API client library for Triton cloud and the command
line tool.**

## Setup

### User accounts, authentication, and security

Before you can use the CLI you'll need an account on the cloud to which you are connecting and
an SSH key uploaded. The SSH key is used to identify and secure SSH access to containers and
other resources in Triton.

If you do not already have an account on Joyent Public Cloud, sign up [here](https://www.joyent.com/public-cloud).


### API endpoint

Each data center has a single CloudAPI endpoint. For Joyent Public Cloud, you can find the
list of data centers [here](https://docs.joyent.com/public-cloud/data-centers).
For private cloud implementations, please consult the private cloud operator for the correct URL.
Have the URL handy as you'll need it in the next step.


### Installation

Install [node.js](http://nodejs.org/), then:

    npm install -g triton

Verify that it is installed and on your PATH:

    $ triton --version
    Triton CLI 4.15.0
    https://github.com/joyent/node-triton

To use `triton`, you'll need to configure it to talk to a Triton DataCenter
API endpoint (called CloudAPI). Commonly that is done using a Triton profile:

    $ triton profile create
    A profile name. A short string to identify a CloudAPI endpoint to the
    `triton` CLI.
    name: sw1

    The CloudAPI endpoint URL.
    url: https://us-sw-1.api.joyent.com

    Your account login name.
    account: bob

    Available SSH keys:
     1. 2048-bit RSA key with fingerprint 4e:e7:56:9a:b0:91:31:3e:23:8d:f8:62:12:58:a2:ec
      * [in homedir] bob-20160704 id_rsa

    The fingerprint of the SSH key you want to use, or its index in the list
    above. If the key you want to use is not listed, make sure it is either saved
    in your SSH keys directory or loaded into the SSH agent.
    keyId: 1

    Saved profile "sw1".

    WARNING: Docker uses TLS-based authentication with a different security model
    from SSH keys. As a result, the Docker client cannot currently support
    encrypted (password protected) keys or SSH agents. If you continue, the
    Triton CLI will attempt to format a copy of your SSH *private* key as an
    unencrypted TLS cert and place the copy in ~/.triton/docker for use by the
    Docker client.
    Continue? [y/n] y
    Setting up profile "sw1" to use Docker.
    Setup profile "sw1" to use Docker (v1.12.3). Try this:
        eval "$(triton env --docker sw1)"
        docker info

    Set "sw1" as current profile (because it is your only profile).

Or instead of using profiles, you can set the required environment variables
(`triton` defaults to an "env" profile that uses these environment variables if
no profile is set). For example:

    TRITON_URL=https://us-sw-1.api.joyent.com
    TRITON_ACCOUNT=bob
    TRITON_KEY_ID=SHA256:j2WoSeOWhFy69BQ0uCR3FAySp9qCZTSCEyT2vRKcL+s

For compatibility with the older [sdc-* tools from
node-smartdc](https://github.com/joyent/node-smartdc), `triton` also supports
`SDC_URL`, `SDC_ACCOUNT`, etc. environment variables.


### Bash completion

Install Bash completion with

```bash
triton completion > /usr/local/etc/bash_completion.d/triton     # Mac
triton completion > /etc/bash_completion.d/triton               # Linux
```

Alternatively, if you don't have or don't want to use a "bash\_completion.d"
dir, then something like this would work:

```bash
triton completion > ~/.triton.completion
echo "source ~/.triton.completion" >> ~/.bashrc
```

Then open a new shell or manually `source FILE` that completion file, and
play with the bash completions:

    triton <TAB>


## `triton` CLI Usage

### Create and view instances

    $ triton instance list
    SHORTID  NAME  IMG  STATE  PRIMARYIP  AGO

We have no instances created yet, so let's create some.  In order to create
an instance we need to specify two things: an image and a package.  An image
represents what will be used as the root of the instances filesystem, and the
package represents the size of the instance, eg. ram, disk size, cpu shares,
etc.  More information on images and packages below - for now we'll just use
SmartOS 64bit and a small 128M ram package which is a combo available on the
Joyent Public Cloud.

    $ triton instance create base-64 t4-standard-128M

Without a name specified, the container created will have a generated ID. Now
to create a container-native Ubuntu 14.04 container with 2GB of ram with the
name "server-1"

    $ triton instance create --name=server-1 ubuntu-14.04 t4-standard-2G

Now list your instances again

    $ triton instance list
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

    $ triton instance get server-1
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

Commonly used container operations are supported in the Triton CLI:

    $ triton help instance
    ...
        list (ls)           List instances.
        get                 Get an instance.
        create              Create a new instance.
        delete (rm)         Delete one or more instances.

        start               Start one or more instances.
        stop                Stop one or more instances.
        reboot              Reboot one or more instances.

        ssh                 SSH to the primary IP of an instance
        wait                Wait on instances changing state.
        audit               List instance actions.

### View packages and images

Package definitions and images available vary between different data centers
and different Triton cloud implementations.

To see all the packages offered in the data center and specific package
information, use

    $ triton package list
    $ triton package get ID|NAME

Similarly, to find out the available images and their details, do

    $ triton image list
    $ triton images ID|NAME

Note that docker images are not shown in `triton images` as they are
maintained in Docker Hub and other third-party registries configured to be
used with Joyent's Triton clouds. **In general, docker containers should be
provisioned and managed with the regular
[`docker` CLI](https://docs.docker.com/installation/#installation)**
(Triton provides an endpoint that represents the _entire datacenter_
as a single `DOCKER_HOST`. See the [Triton Docker
documentation](https://apidocs.joyent.com/docker) for more information.)


## `TritonApi` Module Usage

Node-triton can also be used as a node module for your own node.js tooling.
A basic example appropriate for a command-line tool is:

```javascript
var mod_bunyan = require('bunyan');
var mod_triton = require('triton');

var log = mod_bunyan.createLogger({name: 'my-tool'});

// See the `createClient` block comment for full usage details:
//      https://github.com/joyent/node-triton/blob/master/lib/index.js
mod_triton.createClient({
    log: log,
    // Use 'env' to pick up 'TRITON_/SDC_' env vars. Or manually specify a
    // `profile` object.
    profileName: 'env',
    unlockKeyFn: mod_triton.promptPassphraseUnlockKey
}, function (err, client) {
    if (err) {
        // handle err
    }

    client.listImages(function (err, images) {
        client.close();   // Remember to close the client to close TCP conn.
        if (err) {
            console.error('listImages err:', err);
        } else {
            console.log(JSON.stringify(images, null, 4));
        }
    });
});
```

See the following for more details:
- The block-comment for `createClient` in [lib/index.js](lib/index.js).
- Some module-usage examples in [examples/](examples/).
- The lower-level details in the top-comment in
  [lib/tritonapi.js](lib/tritonapi.js).


## Configuration

This section defines all the vars in a TritonApi config. The baked in defaults
are in "etc/defaults.json" and can be overriden for the CLI in
"~/.triton/config.json" (on Windows: "%APPDATA%/Joyent/Triton/config.json").

| Name | Description |
| ---- | ----------- |
| profile | The name of the triton profile to use. The default with the CLI is "env", i.e. take config from `SDC_*` envvars. |
| cacheDir | The path (relative to the config dir, "~/.triton") where cache data is stored. The default is "cache", i.e. the `triton` CLI caches at "~/.triton/cache". |


## node-triton differences with node-smartdc

- There is a single `triton` command instead of a number of `sdc-*` commands.
- `TRITON_*` environment variables are preferred to the `SDC_*` environment
  variables. However the `SDC_*` envvars are still supported.
- Node-smartdc still has more complete coverage of the Triton
  [CloudAPI](https://apidocs.joyent.com/cloudapi/). However, `triton` is
  catching up and is much more friendly to use.


## Development Hooks

Before commiting be sure to, at least:

    make check      # lint and style checks
    make test-unit  # run unit tests

A good way to do that is to install the stock pre-commit hook in your
clone via:

    make git-hooks

Also please run the full (longer) test suite (`make test`). See the next
section.


## Test suite

node-triton has both unit tests (`make test-unit`) and integration tests (`make
test-integration`). Integration tests require a config file, by default at
"test/config.json". For example:

    $ cat test/config.json
    {
        "profileName": "east3b",
        "allowWriteActions": true,
        "image": "minimal-64",
        "package": "t4-standard-128M"
    }

See "test/config.json.sample" for a description of all config vars. Minimally
just a "profileName" or "profile" is required.

*Warning:* Running the *integration* tests will create resources and could
incur costs if running against a public cloud.

Run all tests:

    make test

You can use `TRITON_TEST_CONFIG` to override the test file, e.g.:

    $ cat test/coal.json
    {
        "profileName": "coal",
        "allowWriteActions": true
    }
    $ TRITON_TEST_CONFIG=test/coal.json make test

where "coal" here refers to a development Triton (a.k.a SDC) ["Cloud On A
Laptop"](https://github.com/joyent/sdc#getting-started) standup.


## Release process

Here is how to cut a release:

1. Make a commit to set the intended version in "package.json#version" and changing `## not yet released` at the top of "CHANGES.md" to:

    ```
    ## not yet released


    ## $version
    ```

2. Get that commit approved and merged via <https://cr.joyent.us>, as with all
   commits to this repo. See the discussion of contribution at the top of this
   readme.

3. Once that is merged and you've updated your local copy, run:

    ```
    make cutarelease
    ```

   This will run a couple checks (clean working copy, versions in package.json
   and CHANGES.md match), then will git tag and npm publish.


## License

MPL 2.0
