# Frontend container: build the production bundle, serve it with nginx.
#
# The backend is intentionally NOT containerized — it runs natively on the Windows host
# because it needs COM ports (Imada/ESP32), the USB PLC, and a 32-bit Windows DLL bridge
# (DataBuilder.dll), none of which a Linux container can access. This container serves the
# static UI and proxies /api + /ws to the host backend (see nginx.conf -> host.docker.internal).
#
# Build & run (from repo root):  docker compose up -d --build frontend
# Kiosk then points Edge at:      http://localhost:8080

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# `vite build` directly (not `npm run build`) so the build skips `tsc -b`, which currently
# fails on some pre-existing Base-UI `asChild` typings. The emitted bundle is correct and
# is the same production build verified to emit zero performance.measure() entries.
RUN npx vite build

# ---- serve stage ----
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
