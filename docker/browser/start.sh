#!/bin/sh
# Starts the virtual display, the VNC bridge, the CDP bridge and keeps Chromium running.
# Signed-in sessions live in /data/profile (volume browser-profile): treat that volume as a secret.
set -eu
SCREEN="${BROWSER_SCREEN:-1366x860}"
W="${SCREEN%x*}"
H="${SCREEN#*x}"

# `docker restart` and a host reboot keep the container's writable layer, so /tmp still holds the lock and
# socket of the previous Xvfb. Xvfb then refuses to start ("Server is already active for display 1"), x11vnc
# has no display and Chromium crash-loops, leaving a 4 MB BrowserMetrics file per start in the profile volume.
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
Xvfb :1 -screen 0 "${SCREEN}x24" -nolisten tcp -nolisten unix &
XVFB_PID=$!
export DISPLAY=:1
sleep 1
kill -0 "$XVFB_PID" 2>/dev/null || { echo "[browser] Xvfb did not start, exiting so Docker restarts the container" >&2; exit 1; }
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
DELAY=2
while true; do
  # No display, no point in starting Chromium: exit and let Docker restart the container (which re-runs the
  # lock cleanup above) instead of spinning.
  kill -0 "$XVFB_PID" 2>/dev/null || { echo "[browser] Xvfb is gone, exiting so Docker restarts the container" >&2; exit 1; }
  rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie
  STARTED=$(date +%s)
  # --no-sandbox: the Chromium sandbox needs user namespaces Docker blocks by default. The container
  # is the sandbox: non-root, no secrets but this profile, no docker socket, no host mounts.
  chromium \
    --user-data-dir=/data/profile \
    --remote-debugging-port=9222 \
    --no-sandbox --disable-dev-shm-usage \
    --no-first-run --no-default-browser-check --password-store=basic \
    --window-position=0,0 --window-size="${W},${H}" --start-maximized \
    about:blank || true
  # Every start leaves a 4 MB BrowserMetrics file behind, so a Chromium that keeps dying within seconds must
  # not be restarted every 2 s: back off 2, 4, 8 ... up to 300 s. A run of 10 s or more resets the delay.
  RAN=$(( $(date +%s) - STARTED ))
  if [ "$RAN" -ge 10 ]; then DELAY=2; fi
  sleep "$DELAY"
  if [ "$RAN" -lt 10 ]; then
    DELAY=$(( DELAY * 2 ))
    [ "$DELAY" -le 300 ] || DELAY=300
  fi
done
