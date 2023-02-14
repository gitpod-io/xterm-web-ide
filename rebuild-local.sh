#!/bin/bash

set -Eeuo pipefail

yarn build
cp /workspace/xterm-web-ide/supervisor-ide-config.json /ide/
rm /ide/xterm && true
ln -s /workspace/xterm-web-ide /ide/xterm
echo "xterm: linked in /ide"

gp rebuild "$@"
