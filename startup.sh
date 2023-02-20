#!/bin/bash -li

cd /ide || exit
exec node /ide/xterm/server.cjs "$@"
