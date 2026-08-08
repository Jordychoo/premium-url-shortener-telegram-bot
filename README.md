# Premium URL Shortener Telegram Bot

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
- Easy to extend with more shortener services
- Public JSON API at `/api/shorten`
- CORS support for website/browser integrations
- Provider selection through the API
- API-side URL and provider validation
- Provider-specific error reporting
- Worker status endpoint at `/`
- Protected Telegram webhook with optional secret validation

## Supported providers

- Bitly
- TinyURL
- is.gd
- v.gd
- lnk.ua
- Cuttly
- CleanURI
- ShortURL.at
- spoo.me
- Tiny.cc
- tinu.be
- yaso.su
- Goo.su
- urli.info
- scn.st
- short-link.me
- tr.ee
- n9.cl
- h1.nu
- come.ac
- Shorter.me
- Reurl.cc
- PicSee
- LinklyHQ
- ShortenWorld API
- centi.ai
- shortens.org
- shorten.world
- sw.run
- shorten.as
- shorten.is
- shorten.tv
- shorten.so
- shorten.ee
- clck.ru
- osdb.link
- Ulvis

## Add more shortener services

This project is designed to be extensible.

If you want, you can add more URL shortener providers by editing the `buildProviders(env)` function in `worker.js`, then adding the new provider key to `ENABLED_PROVIDERS`.

If a provider requires credentials, add them as Cloudflare secrets the same way as `BITLY_TOKEN`, `LNKUA_API_KEY`, `SPOOME_API_KEY`, or `TINYCC_API_KEY`.

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
- `LNKUA_API_KEY`
- `SPOOME_API_KEY`
- `TINYCC_USER`
- `TINYCC_API_KEY`
- `GOOSU_API_TOKEN`
- `REURLCC_API_KEY`
- `PICSEE_ACCESS_TOKEN`
- `LINKLYHQ_API_KEY`
- `LINKLYHQ_WORKSPACE_ID`
- `SHORTENWORLD_USERNAME`
- `SHORTENWORLD_API_KEY`
- `SHORTENWORLD_TEAM_ID`
- `SHORTENWORLD_DOMAIN_ID`

## Important after deployment

You must add the required secrets for the bot to work.

Depending on your Cloudflare deploy flow, Cloudflare may ask for some values during deployment, but you should still verify that the required secrets are actually set after deployment.

At minimum, the bot will not work unless these are present:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

If you enable providers that need credentials, you must also add their matching secrets.

## Provider-specific requirements

Some providers need their own credentials before they can be used.

### Requires credentials

- **Bitly** → `BITLY_TOKEN`
- **Cuttly** → `CUTTLY_API_KEY`
- **lnk.ua** → `LNKUA_API_KEY`
- **spoo.me** → `SPOOME_API_KEY`
- **Tiny.cc** → `TINYCC_USER` and `TINYCC_API_KEY`
- **Goo.su** → `GOOSU_API_TOKEN`
- **Reurl.cc** → `REURLCC_API_KEY`
- **PicSee** → `PICSEE_ACCESS_TOKEN`
- **LinklyHQ** → `LINKLYHQ_API_KEY` and optionally `LINKLYHQ_WORKSPACE_ID`
- **ShortenWorld API** → `SHORTENWORLD_USERNAME`, `SHORTENWORLD_API_KEY`, `SHORTENWORLD_TEAM_ID`, and `SHORTENWORLD_DOMAIN_ID`

### No extra credentials required

- **TinyURL**
- **is.gd**
- **v.gd**
- **CleanURI**
- **ShortURL.at**
- **tinu.be**
- **yaso.su**
- **urli.info**
- **scn.st**
- **short-link.me**
- **tr.ee**
- **n9.cl**
- **h1.nu**
- **come.ac**
- **Shorter.me**
- **centi.ai**
- **shortens.org**
- **shorten.world**
- **sw.run**
- **shorten.as**
- **shorten.is**
- **shorten.tv**
- **shorten.so**
- **shorten.ee**
- **clck.ru**
- **osdb.link**
- **Ulvis**

### Experimental providers

The Worker no longer marks a fixed provider list as experimental. Some providers use website/XHR flows rather than a documented API, so their availability can change if the provider changes its website or API.

## Environment variables

- `ENABLED_PROVIDERS`

Example:

```json
["bitly","tinyurl","isgd","vgd","lnkua","cuttly","cleanuri","shorturlat","spoome","tinycc","tinube","yasosu","goosu","urliinfo","scnst","shortlinkme","treee","n9cl","h1nu","comeac","shorterme","reurlcc","picsee","linklyhq","shortenworldapi","centi","shortens","shortenworld","swrun","shortenas","shortenis","shortentv","shortenso","shortenee","clckru","osdb","ulvis"]
```

You can also use a comma-separated string:

```text
bitly,tinyurl,isgd,vgd,lnkua,cuttly,cleanuri,shorturlat,spoome,tinycc,tinube,yasosu,goosu,urliinfo,scnst,shortlinkme,treee,n9cl,h1nu,comeac,shorterme,reurlcc,picsee,linklyhq,shortenworldapi,centi,shortens,shortenworld,swrun,shortenas,shortenis,shortentv,shortenso,shortenee,clckru,osdb,ulvis
```

## D1 binding

This project uses a D1 database binding named:

```text
LINK_DB
```

## After deployment

### 1. Verify secrets

Before using the bot, confirm that the required secrets are set in Cloudflare:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

Also add any provider-specific secrets for the providers you want enabled.

### 2. Initialize the D1 table

Open this once in your browser:

```text
https://YOUR_WORKER_SUBDOMAIN.workers.dev/init
```

This is safe to run multiple times.

### 3. Set the Telegram webhook

Open this URL in your browser, replacing the placeholders:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR_WORKER_SUBDOMAIN.workers.dev/webhook&secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>
```

### 4. Check the Worker status

Open:

```text
https://YOUR_WORKER_SUBDOMAIN.workers.dev/
```

The status endpoint reports the enabled provider keys and whether the main Telegram, provider, and D1 bindings are configured.

### 5. Start using the bot

Open Telegram and send:

```text
/start
```

## Commands

- `/start` — Start the bot
- `/help` — Learn how to use the bot

## API

The Worker also exposes a JSON API for websites, scripts, and other applications.

### Endpoint

```text
POST https://YOUR_WORKER_SUBDOMAIN.workers.dev/api/shorten
```

The request must contain a JSON body with:

- `url` — the full HTTP or HTTPS URL to shorten
- `provider` — the provider key to use

Example:

```json
{
  "url": "https://www.google.com/",
  "provider": "tinyurl"
}
```

### cURL

#### Linux / macOS

```bash
curl -X POST "https://YOUR_WORKER_SUBDOMAIN.workers.dev/api/shorten" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.google.com/","provider":"tinyurl"}'
```

#### Windows PowerShell

```powershell
curl.exe -X POST "https://YOUR_WORKER_SUBDOMAIN.workers.dev/api/shorten" `
  -H "Content-Type: application/json" `
  -d '{"url":"https://www.google.com/","provider":"tinyurl"}'
```

#### Windows CMD

```cmd
curl.exe -X POST "https://YOUR_WORKER_SUBDOMAIN.workers.dev/api/shorten" -H "Content-Type: application/json" -d "{\"url\":\"https://www.google.com/\",\"provider\":\"tinyurl\"}"
```

### Successful response

```json
{
  "ok": true,
  "provider": "tinyurl",
  "original_url": "https://www.google.com/",
  "short_url": "https://tinyurl.com/..."
}
```

### Error response

```json
{
  "ok": false,
  "provider": "tinyurl",
  "error": "..."
}
```

The API returns an error if the JSON is invalid, the URL is not HTTP/HTTPS, the provider is missing, the provider is unknown or disabled, or the selected provider fails.

### Using it from a website

The API supports CORS for browser-based requests, so a website can call it directly with `fetch()`:

```html
<script>
async function shortenUrl(url, provider) {
  const response = await fetch(
    "https://YOUR_WORKER_SUBDOMAIN.workers.dev/api/shorten",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        provider
      })
    }
  );

  return response.json();
}

shortenUrl("https://www.google.com/", "tinyurl")
  .then(result => {
    if (result.ok) {
      console.log(result.short_url);
    } else {
      console.error(result.error);
    }
  });
</script>
```

Use the provider keys listed in the **Supported providers** section. The provider must also be enabled through `ENABLED_PROVIDERS`.

### API CORS

`POST` and `OPTIONS` are supported for `/api/shorten`. The API currently allows cross-origin browser requests and accepts the `Content-Type` request header.

## API status endpoint

A `GET` request to `/` can be used as a basic configuration/status check:

```text
https://YOUR_WORKER_SUBDOMAIN.workers.dev/
```

It returns the enabled provider keys and boolean flags indicating whether the main bindings/secrets are present.

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
["bitly","vgd","lnkua","spoome"]
```

This will show only:

- Bitly
- v.gd
- lnk.ua
- spoo.me

### Notes

- If `bitly` is enabled, `BITLY_TOKEN` must be set
- If `cuttly` is enabled, `CUTTLY_API_KEY` must be set
- If `lnkua` is enabled, `LNKUA_API_KEY` must be set
- If `spoome` is enabled, `SPOOME_API_KEY` must be set
- If `tinycc` is enabled, both `TINYCC_USER` and `TINYCC_API_KEY` must be set
- If `goosu` is enabled, `GOOSU_API_TOKEN` must be set
- If `reurlcc` is enabled, `REURLCC_API_KEY` must be set
- If `picsee` is enabled, `PICSEE_ACCESS_TOKEN` must be set
- If `linklyhq` is enabled, `LINKLYHQ_API_KEY` must be set
- If `shortenworldapi` is enabled, the ShortenWorld credentials must be set

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
- Several providers use website/XHR flows rather than a documented API and may break if their website flow changes
- `is.gd` and `v.gd` may reject some links based on their own validation or abuse rules
- `Tiny.cc` requires valid account credentials and API access
- `spoo.me` requires a valid API key with the correct scope
- The `/api/shorten` endpoint only accepts HTTP and HTTPS URLs
- The `/api/shorten` endpoint only allows providers that are enabled by `ENABLED_PROVIDERS`
- Telegram webhook requests can be protected with `TELEGRAM_WEBHOOK_SECRET`

## License

MIT
