# first

- Adding/removing DCs. Want this to work reasonably mainly to support dogfooding
  with internal DCs. Also to allow this to be a general tool for *SDC*,
  with default values for JPC, but not restricted to. Also allow the right thing
  to happen if JPC adds new DCs.

    - Don't use "all" catch all DC. Use "joyent" alias for the default set.
    - Add DC aliases (starting a generic aliasing).
    - Show the aliases in `sdc dcs`
    - support aliases in the command lookups. Method to get the DCs for the current
      profile
    XXX START HERE
    - changing dcs:
        sdc dcs add us-beta-4 https://beta4-cloudapi.joyent.us
        sdc dcs set-url us-beta-4 https://beta4-cloudapi.joyent.us
        sdc dcs rm us-beta-4
      Note: If having config.dcs override this means that any DC change means
      that user doesn't "see" DC changes by new node-sdc versions.
    - Impl 'sdc config' to edit these easily on the CLI.
          sdc config alias.dc.<alias> <dc-name-1> <dc-name-2> ...
          sdc config alias.image.<alias> <image-uuid> ...

- machines:
    - short default output
        - 'cdate'   short created, just the date
        - 'img'   is 'name/version'
        - 'sid'   is the short id prefix
    - long '-l' output, -H, -o, -s
    - get image defaults and fill those in

- few more commands?  provision (create-machine?)


- uuid caching
- UUID prefix support
- profile command (adding profile, edit, etc.)
- `sdc config` command similar to git config


# account vs user vs subuser vs role

See MANTA-2401 and scrum discussion from 14 Aug 2014..
Suggestion: use "account" and "user" since "since those are the documented
tools for the abstractions and that's what smartdc uses."
Envvars: SDC_ACCOUNT and SDC_USER.


# later (in no particular order)

- adding a dc:
        sdc dcs -a us-beta-4 https://beta4-cloudapi.joyent.us
  or
- signing: should sigstr include more than just the date? How about the request
  path??? Not according to the cloudapi docs.
- restify-client and bunyan-light without dtrace-provider
- Get node-smartdc-auth to take a log option. Perhaps borrow from imgapi.js'
  cliSigner et al.
- node-smartdc-auth: Support a path to a priv key for "keyId" arg. Or a separate
  alternative arg. Copy this from imgapi.cliSigner.
        sign: cloudapi.cliSigner({
            keyId: <KEY-ID>,
            user: <USER>,
            log: <BUNYAN-LOGGER>,
        }),
- the error reporting for a signing error sucks:
    getAccount: err { message: 'error signing request',
        code: 'Signing',
        exitStatus: 1 }
    e.g. when the KEY_ID is nonsense. Does imgapi's auth have better error
    reporting?
- how to add/exclude DCs?
- cmdln.js support for bash tab completion
- node-smartdc installs joyentcloud and warns about deprecation on stderr.
- bunyan logging setup:
    - one output stream to a file at trace level:
      /var/log/joyentcloud/$timestamp.log
    - periodically keep the number of those files down. This is hard. Do it
      at startup? Yah should be fine.
    - another "raw" stream to stderr at WARN at above (maybe INFO?)
      where we console.error just the minimal fields that we want to show
        joyentcloud: warn: $msg
      Not sure about other fields.
- plugin support, e.g. allow 3rd-party node-joyentcloud-foo npm modules that would
  add a "joyentcloud foo" subcmd. Reasonable?
- windows testing

# ideas

- `sdc whatsnew` grabs current images and packages and compares to last time
  it was called to short new images/packages. Perhaps for other resources too.



# notes on `sdc provision` (in progress)

- Lame: I <# that our packages are separate for kvm vs smartos usage. Do they
  have conflicting data?
- Q: "package" or "instance-type"? Probably package for now.

Need: dc (if profile has multiple, have a settable preferred dc for provisions),
image (uuid, name to get latest, have a settable preferred?), package (settable
preferred, settable preferred ram).

What about using "same as last time" or a way to say that?

Want interactive asking for missing params if TTY? -f to avoid.

    $ sdc provision ...
    Datacenter [us-west-1]: <prompt>
    ...

Name: AWS equiv is 'aws-cli ec2 run-instances'
http://docs.aws.amazon.com/cli/latest/reference/ec2/run-instances.html
E.g.:

    aws ec2 run-instances --image-id ami-c3b8d6aa --count 1 --instance-type t1.micro --key-name MyKeyPair --security-groups MySecurityGroup

    sdc create-machine ...
    sdc provision ...
    sdc provision -i IMAGE -p PACKAGE
    shortcut?
        sdc provision IMAGE:PKG     ?
        sdc provision IMAGE PKG     ?
        sdc provision image=IMAGE package=PKG  ? no

    sdc provision -i IMAGE -p PKG -c 3 --name 'test%d'  # printf codes for the count
    sdc provision -d east -i base -p g3-standard-1 -n shirley  # -d|--dc

Clarify what IMAGE can be. "Name" matching is first against one's own private
images, then against public ones. UUID. UUID prefix. "Name/version" matching.
Image alias (`sdc config alias.bob $uuid`, though for git that alias is for
*commands*. Perhaps `sdc alias image.bob $uuid`. Dunno. Later.).

Similar matching for PKG.
