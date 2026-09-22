# --- Build stage ---
FROM node:22-slim AS build

WORKDIR /app

# Copy the lockfile too, so installs are reproducible and fast.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

# Baked into the static JS bundle at build time (CRA/craco behavior) -- this must
# be the public URL the browser will use to reach the backend's /api routes.
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

# package.json sets "homepage": "." so Capacitor can load assets from inside the
# APK. The website is served from the domain root, where relative asset paths
# break deep links like /inspections/<id>, so force absolute paths here.
ENV PUBLIC_URL=/

RUN yarn build

# --- Serve stage ---
FROM nginx:1.27-alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
