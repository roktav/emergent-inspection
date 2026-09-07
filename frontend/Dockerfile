# --- Build stage ---
FROM node:20-slim AS build

WORKDIR /app

COPY package.json ./
# No yarn.lock is committed in the source repo, so this resolves fresh versions
# within the ranges pinned in package.json.
RUN yarn install

COPY . .

# Baked into the static JS bundle at build time (CRA/craco behavior) -- this must
# be the public URL the browser will use to reach the backend's /api routes.
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

RUN yarn build

# --- Serve stage ---
FROM nginx:1.27-alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
