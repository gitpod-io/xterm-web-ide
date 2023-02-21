#!/bin/bash -li

cd /ide || exit
exec /ide/xterm/node /ide/xterm/index.cjs "$@"
