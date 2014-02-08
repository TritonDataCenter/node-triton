# first

- machines:
    - short default output
    - long '-l' output, -H, -o, -s
    - get image defaults and fill those in
- couple commands: machines, machine, provision (create-machine?)
- re-write of cloudapi.js (eventually a separate module)
- uuid caching
- UUID prefix support
- profile command (adding profile, edit, etc.)
- multi-dc support... profile.dcs



# later (in no particular order)

- restify-client and bunyan-light without dtrace-provider
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
- windows testing

