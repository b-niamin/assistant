#!/bin/sh
# Daily pg_dump into the `backups` volume; dumps older than KEEP_DAYS are pruned.
set -u
until pg_isready -q; do sleep 2; done
while true; do
  stamp=$(date +%F)
  if pg_dump -Fc -f "/backups/assistant-$stamp.dump"; then
    echo "[backup] ok $stamp"
  else
    echo "[backup] FAILED $stamp"
  fi
  find /backups -name 'assistant-*.dump' -mtime "+${KEEP_DAYS:-14}" -exec rm -f {} \;
  sleep 86400
done
