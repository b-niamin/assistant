<div align="center">

<img src="apps/web/static/beni.svg" alt="Beni, the assistant's mascot: an orange jelly-bean runner in a sweatband" width="128" />

# Beni Assistant

### Your private assistant, self-hosted at home.

A small app for your NAS that grows with extensions, and Claude inside to run them and build new ones.

[Install](#-quick-start) · [Screenshots](#-screenshots) · [Extensions](https://github.com/b-niamin/assistant-extensions) · [Docs](#-learn-more)

![Self-hosted](https://img.shields.io/badge/self--hosted-Docker_Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![Synology](https://img.shields.io/badge/runs_on-Synology_%C2%B7_Linux-B5B5B6?style=flat-square&logo=synology&logoColor=white)
![Tailscale](https://img.shields.io/badge/access-Tailscale_HTTPS-242424?style=flat-square&logo=tailscale&logoColor=white)
![Claude Code](https://img.shields.io/badge/AI_inside-Claude_Code_%C2%B7_Codex-D97757?style=flat-square&logo=anthropic&logoColor=white)

<img src="docs/screenshots/tour.gif" alt="A tour of the app: dashboard, Training &amp; Health, an activity, the gym tracker, Home, System settings and the terminal" width="900" />

</div>

## ✨ What you get

<table>
  <tr>
    <td width="33%" valign="top"><h3>🏠 Yours, at home</h3>One Docker Compose stack on your NAS or Linux box. Your data never leaves your hardware.</td>
    <td width="33%" valign="top"><h3>🧩 Apps as extensions</h3>Training &amp; health, a gym tracker, a home board, or anything you ask for, added from System settings.</td>
    <td width="33%" valign="top"><h3>🤖 Claude inside</h3>Claude Code and Codex live in the stack: they read every app's data and build new extensions on request.</td>
  </tr>
  <tr>
    <td valign="top"><h3>👨‍👩‍👧 One password, many profiles</h3>Each person gets their own data behind one app password. No accounts to manage.</td>
    <td valign="top"><h3>🔒 Private by design</h3>Reached only over your Tailscale tailnet with HTTPS. Nothing open to the internet or the LAN.</td>
    <td valign="top"><h3>🔄 Keeps itself current</h3>Updates from GitHub <code>main</code> on a schedule or with one click in System settings.</td>
  </tr>
</table>

## 🚀 Quick start

On a Synology NAS or any Linux machine with Docker and Compose:

```sh
curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant/main/install.sh | sudo sh
```

1. Answer the questions with Enter (folder, port, extensions, auto-update).
2. Open the printed address + `/setup`, type the setup code, pick a password and your profile.
3. Done. Check the install any time with `sudo ./beni.sh doctor`.

Synology step by step, every installer option and the `beni.sh` commands: [docs/install.md](docs/install.md).

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard with tiles from the extensions" /><p align="center"><b>Dashboard</b>: tiles from every extension</p></td>
    <td width="50%"><img src="docs/screenshots/home.png" alt="The Home extension: weather, lights, doors and today's calendar" /><p align="center"><b>Home</b>: an extension on a wall tablet</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings.png" alt="System settings: apps, profiles and the terminal" /><p align="center"><b>System settings</b>: apps, people, updates</p></td>
    <td><img src="docs/screenshots/terminal.png" alt="The terminal docked at the bottom of a page" /><p align="center"><b>Terminal</b>: Claude Code, Codex, a shell</p></td>
  </tr>
</table>

<p align="center">Light and dark (<a href="docs/screenshots/dashboard-dark.png">dark dashboard</a>). All screenshots use demo data.</p>

## 🧭 How it works

```mermaid
flowchart LR
  you(["📱 You<br/>phone · laptop · tablet"]) -- "Tailscale HTTPS" --> web
  subgraph box ["🏠 Your NAS or Linux box · Docker Compose"]
    llm["🤖 llm<br/>Claude Code · Codex"] -- "tools" --> web["🌐 web<br/>the app + extensions"]
    web --> db[("🐘 Postgres<br/>a schema per extension")]
    svc["⚙️ extension services<br/>e.g. garmin-sync"] --> db
  end
```

The core is a shell: login, profiles, dashboard, System settings, terminal. Everything else is an
extension from [assistant-extensions](https://github.com/b-niamin/assistant-extensions) or one Claude
built for you. The stack updates itself from GitHub `main`. More in the [architecture spec](specs/000-architecture.md).

## 📚 Learn more

- 🧩 **[Extensions repo](https://github.com/b-niamin/assistant-extensions)**: ready-made apps and inspirations to build from
- 🛠️ **[Install and run](docs/install.md)**: installer details, Synology walkthrough, `beni.sh`, development
- 🏗️ **[Architecture](specs/000-architecture.md) · [Extensions](specs/002-extensions.md) · [Security](specs/004-security.md)**: how it is built ([all specs](specs))
- 🤝 **[AGENTS.md](AGENTS.md)**: rules for people and AI agents working in this repo
