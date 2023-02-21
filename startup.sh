#!/bin/bash -li

cd /ide || exit
exec /ide/bin/node /ide/index.cjs "$@"
