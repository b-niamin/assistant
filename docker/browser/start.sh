#!/bin/sh
# Starts the virtual display, the VNC bridge, the CDP bridge and keeps Chromium running.
# Signed-in sessions live in /data/profile (volume browser-profile): treat that volume as a secret.
set -eu
SCREEN="${BROWSER_SCREEN:-1366x860}"
W="${SCREEN%x*}"
H="${SCREEN#*x}"

Xvfb :1 -screen 0 "${SCREEN}x24" -nolisten tcp -nolisten unix &
export DISPLAY=:1
sleep 1
# VNC only on loopback; websockify is the one network door to it (internal network only).
x11vnc -display :1 -localhost -rfbport 5900 -forever -shared -nopw -quiet -noxdamage &
# websockify accepts only handshakes carrying the app's Origin, which the web proxy sets (apps/web/server.mjs).
# A page open in this Chromium reaches websockify too (localhost:6080, browser:6080), and the VNC has no
# password: without this check any web page could drive the signed-in browser. VNC_EXPECT_ORIGIN =
# PUBLIC_ORIGIN; a page cannot send that Origin, because the app is not reachable from this container.
if [ -n "${VNC_EXPECT_ORIGIN:-}" ]; then
  websockify --heartbeat 30 --auth-plugin websockify.auth_plugins.ExpectOrigin --auth-source "$VNC_EXPECT_ORIGIN" \
    0.0.0.0:6080 127.0.0.1:5900 &
else
  echo "[browser] VNC_EXPECT_ORIGIN is not set: noVNC accepts any origin (set PUBLIC_ORIGIN in .env)" >&2
  websockify --heartbeat 30 0.0.0.0:6080 127.0.0.1:5900 &
fi
# Chromium binds CDP to loopback only; this forwards it to the internal network for Claude.
socat TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222 &

mkdir -p /data/profile
while true; do
  rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie
  # --no-sandbox: the Chromium sandbox needs user namespaces Docker blocks by default. The container
  # is the sandbox: non-root, no secrets but this profile, no docker socket, no host mounts.
  chromium \
    --user-data-dir=/data/profile \
    --remote-debugging-port=9222 \
    --no-sandbox --disable-dev-shm-usage \
    --no-first-run --no-default-browser-check --password-store=basic \
    --window-position=0,0 --window-size="${W},${H}" --start-maximized \
    about:blank || true
  sleep 2
done
