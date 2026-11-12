# extensions/

The apps installed on this instance. See [specs/002-extensions.md](../specs/002-extensions.md).
Everything here except this README is git-ignored: it belongs to your instance, not to the core repo.

- `installed.json`: the apps that are on (nav order), who sees them by default, and where each came
  from (`from`: the extensions repo at a commit) or what it was inspired by (`inspiredBy`).
- `<id>/`: one extension. Ready-made ones come from
  [assistant-extensions](https://github.com/b-niamin/assistant-extensions); Claude builds new ones here
  (`add-extension` skill), taking any repo, app or idea only as inspiration. Its settings are in its
  panel: System settings -> <name>.

```sh
node scripts/ext.mjs available                  # what the extensions repo offers
node scripts/ext.mjs install health gym         # copy them here and turn them on
node scripts/ext.mjs update health              # take the repo's newer version
node scripts/ext.mjs list
node scripts/ext.mjs languages                  # the app's languages and what each app still lacks (spec 007)
node scripts/ext.mjs new <id> --kind native|onefile --scope profile|shared [--from inspiration:<name>] [--inspired-by <link>]
```

An extension's background work (manifest `services` / `jobs`, e.g. health's garmin-sync) runs in the
`worker` container, which starts it within seconds (System settings -> Worker). Only an extension that
ships its own `compose.yml` needs `./install.sh` on the host once, which adds it to `COMPOSE_FILE`. This folder is mounted
read-only at `/extensions` in the `web` and `migrate` containers. Set `EXTENSIONS_REPO` to use a fork.
