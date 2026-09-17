FROM docker.io/library/node:22.19.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ bash && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.15 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python
WORKDIR /opt/eaa-pi
COPY package.json npm-shrinkwrap.json ./
COPY vendor ./vendor
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN bash node_modules/pi-experiment-ops/scripts/install.sh --runtime-only && if [ -d src ]; then npm run build; fi && npm prune --omit=dev --legacy-peer-deps --no-audit --no-fund
ENV NODE_ENV=production PI_GRAPH_PYTHON=/opt/eaa-pi/node_modules/pi-experiment-ops/.runtime/python/bin/python
RUN mkdir -p /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
EXPOSE 8010
ENTRYPOINT ["node", "/opt/eaa-pi/bin/eaa-pi.mjs"]
CMD ["serve", "--workspace", "/workspace", "--host", "0.0.0.0"]
