<p align="center">
  <img src="apps/web/static/beni.svg" alt="Beni, the assistant's mascot: an orange jelly-bean runner in a sweatband" width="120" />
</p>

<h1 align="center">Beni Assistant</h1>

<p align="center"><b>Your private assistant, self-hosted at home.</b><br />
A small core app plus extensions, with Claude inside to run them and build new ones.</p>

<p align="center">
  <img src="docs/screenshots/tour.gif" alt="A tour of the app: dashboard, Training &amp; Health, an activity, the gym tracker, Home, System settings and the terminal" width="880" />
</p>

- **Self-hosted**: one Docker Compose stack on your NAS or Linux box; data stays on your hardware.
- **Extensions are the apps**: training & health, a gym tracker, a home board, or anything you ask Claude to build.
- **Claude inside**: Claude Code and Codex run in the stack, reachable through Remote Control.
- **One password, many profiles**: reached over your Tailscale tailnet with HTTPS.
- **Keeps itself current**: updates from GitHub `main`, from System settings or a scheduled task.

## Install

On a Synology NAS or any Linux machine with Docker and Compose:

```sh
curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant/main/install.sh | sudo sh
```

Answer with Enter, open the printed address + `/setup`, type the setup code, choose a password and a profile.
Check it any time with `sudo ./beni.sh doctor`.

## Screenshots

| | |
|---|---|
| <img src="docs/screenshots/dashboard.png" alt="Dashboard with tiles from the extensions" width="420" /><br />**Dashboard**: tiles from every extension | <img src="docs/screenshots/home.png" alt="The Home extension: weather, lights, doors and today's calendar" width="420" /><br />**An extension**: Home |
| <img src="docs/screenshots/settings.png" alt="System settings: apps, profiles and the terminal" width="420" /><br />**System settings**: apps, people, updates | <img src="docs/screenshots/terminal.png" alt="The terminal docked at the bottom of a page" width="420" /><br />**Terminal**: Claude Code, Codex, a shell |

Dark theme too: [dashboard](docs/screenshots/dashboard-dark.png). All screenshots use demo data.

## More

- **Extensions**: [b-niamin/assistant-extensions](https://github.com/b-niamin/assistant-extensions), ready-made apps and inspirations.
- **Install details, Synology step by step, `beni.sh`, development**: [docs/install.md](docs/install.md).
- **How it works**: [architecture](specs/000-architecture.md), [extensions](specs/002-extensions.md),
  [security](specs/004-security.md), [all specs](specs).
- **Working in this repo** (people and AI agents): [AGENTS.md](AGENTS.md).
