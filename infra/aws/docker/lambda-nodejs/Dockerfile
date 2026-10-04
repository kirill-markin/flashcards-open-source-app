# Keep aligned with aws-cdk-lib/aws-lambda-nodejs/lib/docker/Dockerfile.
ARG IMAGE=public.ecr.aws/sam/build-nodejs24.x
FROM $IMAGE

RUN npm install --global yarn@1.22.5

RUN npm install --global pnpm@7.33.7

RUN npm install --global --allow-scripts=bun@1.2.23 bun@1.2.23

RUN npm install --global typescript

ARG ESBUILD_VERSION=0.21
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
