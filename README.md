# Premium URL Shortener Telegram Bot

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Jordychoo/premium-url-shortener-telegram-bot)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)
![D1](https://img.shields.io/badge/Cloudflare-D1-lightgrey)
![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-2CA5E0)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

A premium Telegram URL shortener bot built on Cloudflare Workers.

Send any valid URL, choose your preferred shortening service, and get a clean, share-ready short link in seconds.


## Try the live bot

Want to test the experience before deploying your own copy?

**Try it here:** [@ShortThisUrlBot](https://t.me/ShortThisUrlBot)

## Why this bot?

Most Telegram link shortener bots feel basic. This one is designed to feel polished.

- Interactive provider selection
- Premium Telegram UX
- Multiple shortener services
- Cloudflare Workers deployment
- D1-backed pending request storage
- Easy to fork and deploy

## Features

- Premium Telegram experience
- Interactive provider selection with inline buttons
- Multiple URL shortener providers
- Cloudflare Workers deployment
- D1-backed pending request storage
- One-click deploy support
- Easy provider enable/disable configuration

## Supported providers

- Bitly
- TinyURL
- is.gd
- v.gd
- Cuttly
- CleanURI
- ShortURL.at (experimental)

## Add more shortener services

This project is designed to be extensible.

If you want, you can add more URL shortener providers by editing the `buildProviders(env)` function in `worker.js`, then adding the new provider key to `ENABLED_PROVIDERS`.

If a provider requires credentials, add them as Cloudflare secrets the same way as `BITLY_TOKEN` or `CUTTLY_API_KEY`.

## Demo flow

1. User sends a valid URL to the bot
2. Bot displays available shortening providers
3. User selects one provider
4. Bot returns a clean short URL instantly

## One-click deploy

Click the button below to deploy your own copy to Cloudflare:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Jordychoo/premium-url-shortener-telegram-bot)

## Required secrets

These must be added in Cloudflare:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

## Optional secrets

These are only needed if the corresponding provider is enabled:

- `BITLY_TOKEN`
- `CUTTLY_API_KEY`

## Environment variables

- `ENABLED_PROVIDERS`

Example:

```json
["bitly","tinyurl","isgd","vgd","cuttly","cleanuri","shorturlat"]
```

You can also use a comma-separated string:

```text
bitly,tinyurl,isgd,vgd,cuttly,cleanuri,shorturlat
```

## D1 binding

This project uses a D1 database binding named:

```text
LINK_DB
```

## After deployment

### 1. Initialize the D1 table

Open this once in your browser:

```text
https://YOUR_WORKER_SUBDOMAIN.workers.dev/init
```

This is safe to run multiple times.

### 2. Set the Telegram webhook

Open this URL in your browser, replacing the placeholders:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR_WORKER_SUBDOMAIN.workers.dev/webhook&secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>
```

### 3. Start using the bot

Open Telegram and send:

```text
/start
```

## Commands

- `/start` — Start the bot
- `/help` — Learn how to use the bot

## Telegram bot profile text

### About

```text
🔗 Clean, fast, premium link shortener.
```

### Description

```text
✨ Turn long links into clean, share-ready short URLs — right inside Telegram.

Just send your link, choose your preferred shortening service, and get a polished short URL in seconds. Fast, simple, and built for a premium experience.
```

## Configuration

### Enable or disable providers

Control visible providers with `ENABLED_PROVIDERS`.

Example:

```json
["bitly","tinyurl","isgd"]
```

This will show only:

- Bitly
- TinyURL
- is.gd

### Notes

- If `bitly` is enabled, `BITLY_TOKEN` must be set
- If `cuttly` is enabled, `CUTTLY_API_KEY` must be set
- If you do not want experimental support for ShortURL.at, remove `shorturlat` from `ENABLED_PROVIDERS`

## Project structure

```text
worker.js
wrangler.jsonc
package.json
.dev.vars.example
.gitignore
README.md
```

## Local development

You can also run and test the Worker locally with Wrangler if needed, but this template is primarily designed for Cloudflare deployment.

## Notes

- `/init` only creates the required D1 table and index if they do not already exist
- Running `/init` multiple times does not delete or duplicate data
- ShortURL.at support is experimental and may become unreliable if their public website flow changes
- v.gd and is.gd may reject some links based on their own validation or abuse rules

## License

MIT
