ARG IMAGE=public.ecr.aws/sam/build-nodejs24.x
FROM $IMAGE

RUN npm install --global --allow-scripts=yarn@1.22.22 yarn@1.22.22

RUN npm install --global --allow-scripts=pnpm@12.15.0 pnpm@12.15.0

RUN npm install --global --allow-scripts=bun@1.4.4 bun@1.4.4

RUN npm install --global typescript

ARG ESBUILD_VERSION=0.28.2
RUN npm install --global --allow-scripts=esbuild@$ESBUILD_VERSION esbuild@$ESBUILD_VERSION

RUN mkdir /tmp/npm-cache && \
    chmod -R 777 /tmp/npm-cache && \
    npm config --global set cache /tmp/npm-cache

RUN mkdir /tmp/yarn-cache && \
    chmod -R 777 /tmp/yarn-cache && \
    yarn config set cache-folder /tmp/yarn-cache

RUN mkdir /tmp/pnpm-cache && \
    chmod -R 777 /tmp/pnpm-cache && \
    pnpm config --global set store-dir /tmp/pnpm-cache

RUN npm config --global set update-notifier false

RUN /sbin/useradd -u 1000 user && chmod 711 /

RUN mkdir /tmp/bun-cache && \
    chmod -R 777 /tmp/bun-cache && \
    echo -e "[install.cache]\ndir = \"/tmp/bun-cache\"\ndisable = true" >> /home/user/.bunfig.toml

USER nobody

CMD [ "esbuild" ]
