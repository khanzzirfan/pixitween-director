# One small container: the built web app and the Node server, with ffmpeg for audio and clip handling.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app /app
EXPOSE 8080
# Runs as root on purpose: a Fly volume is mounted root-owned. Secrets are set with `fly secrets`, never baked in here.
CMD ["npm", "start"]
