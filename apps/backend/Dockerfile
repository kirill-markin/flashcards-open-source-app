FROM node:24.22.1-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/patch-just-bash.mts scripts/
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:24.22.1-alpine

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend

COPY package.json package-lock.json ./
COPY scripts/patch-just-bash.mts scripts/
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/

USER backend
EXPOSE 8080
CMD ["node", "dist/entrypoints/index.js"]
