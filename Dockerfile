# syntax=docker/dockerfile:1

# --- build stage: install all deps, compile, then drop dev deps -------------
FROM node:22-slim AS build
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# bcrypt ships a linux-x64 prebuild (node-gyp-build loads it at runtime), so we
# skip dependency install scripts entirely — this avoids pnpm's build-script
# approval gate (ERR_PNPM_IGNORED_BUILDS) with no loss of functionality.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build
# Strip devDependencies for the runtime image.
RUN pnpm prune --prod

# --- runtime stage: slim image with only prod deps + build output ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# The host/proxy provides PORT; the app binds 0.0.0.0. 3000 is the local default.
EXPOSE 3000
CMD ["node", "dist/main"]
