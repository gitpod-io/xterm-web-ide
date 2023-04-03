#!/bin/bash -li

cd /ide/xterm || exit
exec /ide/xterm/bin/node /ide/xterm/index.cjs "$@"
