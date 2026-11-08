# In-app browser (spec 004): Chromium on a virtual display. The owner signs in to services through the
# noVNC view in the app (System settings -> Browser); Claude drives the same browser over CDP.
# No published ports: noVNC (6080) and CDP (9223) are reachable only on the internal `sidecars` network.
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium xvfb x11vnc websockify socat ca-certificates fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core tini \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 -s /bin/sh browser && mkdir -p /data && chown browser /data
USER browser
COPY --chown=browser start.sh /usr/local/bin/browser-start
ENTRYPOINT ["tini", "--", "sh", "/usr/local/bin/browser-start"]
