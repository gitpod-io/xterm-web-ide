# Copyright (c) 2023 Gitpod GmbH. All rights reserved.
# Licensed under the GNU Affero General Public License (AGPL).
# See License-AGPL.txt in the project root for license information.

FROM node:16 as ide_installer

ARG XTERM_COMMIT

RUN apt update && apt install python3
ADD . /ide-prepare/
WORKDIR /ide-prepare/
RUN yarn --frozen-lockfile --network-timeout 180000 && \
    yarn build
RUN cp -r dist/ /ide/
RUN rm -rf dist/
RUN yarn package:server
RUN echo ${XTERM_COMMIT} > dist/commit.txt
RUN cp -r dist/ out-server/
RUN chmod -R ugo+x /ide

FROM scratch
# copy static web resources in first layer to serve from blobserve
COPY --chown=33333:33333 --from=ide_installer /ide/ /ide/
COPY --chown=33333:33333 --from=ide_installer /ide-prepare/out-server/ /ide/
COPY --chown=33333:33333 --from=ide_installer /ide-prepare/node_modules/node/bin/node /ide/bin/
COPY --chown=33333:33333 startup.sh supervisor-ide-config.json /ide/

ENV GITPOD_ENV_SET_EDITOR=/usr/bin/nano
ENV GITPOD_ENV_SET_VISUAL="$GITPOD_ENV_SET_EDITOR"
ENV GITPOD_ENV_SET_GP_OPEN_EDITOR="$GITPOD_ENV_SET_EDITOR"
ENV GITPOD_ENV_SET_GIT_EDITOR="$GITPOD_ENV_SET_EDITOR"

ARG XTERM_COMMIT
LABEL "io.gitpod.ide.commit"=$XTERM_COMMIT

