# AIWH OpenClaw Container
# Installs Linux ARM64 node_modules inside image (no macOS binaries)
FROM node:22-slim

# System deps + build tools for native Node modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    curl jq git ffmpeg sqlite3 ca-certificates \
    build-essential python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Python packages
RUN python3 -m pip install --break-system-packages requests numpy

# Reuse existing node user (UID/GID 1000)
RUN usermod -l sandbox -d /home/sandbox -m node 2>/dev/null || true && \
    groupmod -n sandbox node 2>/dev/null || true

# Copy package.json and install Linux-native deps
# This builds native bindings (davey, bufferutil, zlib-sync) for Linux ARM64
COPY openclaw-package.json /opt/openclaw/package.json
RUN cd /opt/openclaw && npm install

# Create mount points + client trash dir (BEFORE gcc needs /opt/AIWH/bin/)
RUN mkdir -p /opt/AIWH/core /opt/AIWH/client /opt/AIWH/.openclaw \
    /opt/AIWH/client/trash /opt/AIWH/client/logs /opt/AIWH/bin

# Build landlock-guard (kernel-level filesystem sandbox)
# Compiled as static binary — no runtime deps. Runs before Node.js.
COPY landlock-guard.c /tmp/landlock-guard.c
RUN gcc -static -o /opt/AIWH/bin/landlock-guard /tmp/landlock-guard.c -Wall && \
    rm /tmp/landlock-guard.c && \
    chmod 755 /opt/AIWH/bin/landlock-guard

# Fix ownership after binary is in place
RUN chown -R sandbox:sandbox /opt/AIWH

USER sandbox
WORKDIR /opt/AIWH/core
EXPOSE 18789

# dist/ is mounted at runtime from host — node_modules from this image
COPY entrypoint.sh /opt/entrypoint.sh
ENTRYPOINT ["/opt/entrypoint.sh"]
CMD ["gateway"]
