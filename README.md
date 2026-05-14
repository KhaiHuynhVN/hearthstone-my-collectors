# Hearthstone · My Collectors

A cyberpunk-themed web app to track your Hearthstone card collection and export it as JSON for AI-assisted deck building.

**Live demo:** https://khaihuynhvn.github.io/hearthstone-my-collectors/

## Features

- Loads the latest collectible Hearthstone cards from [HearthstoneJSON](https://hearthstonejson.com/) (auto-updates with new expansions).
- Filter by **game mode** (Constructed / Battlegrounds / Mercenaries / All), **format** (Standard / Wild), **class**, and **mana cost**, plus full-text search.
- Mark cards you own (1× or 2× depending on rarity). Saved in `localStorage`.
- Two tabs: **All Cards** and **Owned**.
- One-click **Copy Owned JSON** — pastes a clean array (no images, full card metadata) you can give to any AI to build a deck.
- **Download / Import** your collection as JSON for backup or syncing across devices.
- Cyberpunk dark theme. No tracking, no backend, no Blizzard API needed.

## Why no auto-fetch from your account?

Blizzard does **not** expose a public API for player-owned card collections. The only ways to read your collection live are tools like Hearthstone Deck Tracker / Overwolf, which require the Hearthstone client to be running. This app is the simplest portable alternative — pick what you own once, then re-export anytime.

## Local dev

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into ./dist
```

## Tech stack

- Vite + React 19 + TypeScript
- Tailwind CSS 3
- HearthstoneJSON (`api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json`)

## License

MIT — card data © Blizzard Entertainment. This project is not affiliated with Blizzard.
