# Reddix — local social-CLI canvas automation workbench.
# Note: the rdt-cli / twitter-cli binaries are NOT bundled (V1 detects and
# reports missing binaries). Mount or install them into the image/PATH yourself
# if you want CLI-backed blocks to run.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy sources and build the frontend bundle into ./dist.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
# Containers must bind to 0.0.0.0 to be reachable via a mapped port. Run with
# `-p 127.0.0.1:8787:8787` to keep it on the host loopback only.
ENV HOST=0.0.0.0
# Restrict CORS to wherever the UI is actually served from.
# ENV REDDIX_ALLOWED_ORIGINS=http://127.0.0.1:8787

EXPOSE 8787

# Persist flows/runs/artifacts by mounting a volume at /data.
ENV REDDIX_DATA_DIR=/data
VOLUME ["/data"]

CMD ["npm", "start"]
