# The worker (spec 002, "Background work"): runs the extensions' services and scheduled jobs under one
# supervisor, each extension as its own user. Python 3.15 for the services, Node for any written in JS.
FROM node:26-trixie-slim AS node

FROM python:3.15-slim
# tzdata: cron schedules follow the app's time zone (TZ).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# The supervisor comes from the image (built from main by the host's updater), not from the checkout that
# Claude edits: the one process here that runs as root runs only reviewed code.
COPY worker.py access.json /opt/worker/
# What extension services import (`import beni`): on every unit's PYTHONPATH.
COPY lib /opt/worker/lib
RUN printf '#!/bin/sh\nexec python3 /opt/worker/worker.py run "$@"\n' > /usr/local/bin/ext-run \
 && chmod 755 /usr/local/bin/ext-run \
 && python3 -m py_compile /opt/worker/worker.py /opt/worker/lib/beni/__init__.py
WORKDIR /opt/worker
CMD ["python3", "-u", "/opt/worker/worker.py"]
