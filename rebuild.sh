#!/bin/bash

set -Eeuo pipefail

docker build . -t xterm

rm -rf /workspace/rebuild && true
mkdir -p /workspace/rebuild
docker save xterm -o /workspace/rebuild/xterm.tar
tar -xvf /workspace/rebuild/xterm.tar -C /workspace/rebuild/
find /workspace/rebuild/ -name layer.tar -exec tar -xvf {} -C /workspace/rebuild/ \;

cp /workspace/rebuild/ide/supervisor-ide-config.json /ide/
rm /ide/xterm && true
ln -s /workspace/rebuild/ide/xterm /ide/xterm
echo "xterm: linked in /ide"

gp rebuild "$@"
