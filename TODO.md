# first

- machines:
    - short default output
    - long '-l' output, -H, -o, -s
    - get image defaults and fill those in
- couple commands: machine, provision (create-machine?)
- re-write of cloudapi.js (eventually a separate module)
- uuid caching
- UUID prefix support
- profile command (adding profile, edit, etc.)



# later (in no particular order)

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

