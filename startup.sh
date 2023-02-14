#!/bin/bash -li

cd /ide || exit
exec /ide/xterm/node_modules/node/bin/node /ide/xterm/server.cjs "$@"
