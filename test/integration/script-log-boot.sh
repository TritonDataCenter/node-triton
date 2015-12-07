#!/bin/sh
LOGFILE=/var/log/boot.log
touch $LOGFILE
echo "booted: $(date -u "+%Y%m%dT%H%M%SZ")" >>$LOGFILE
