export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: "telegram-url-shortener-worker",
          configuredProviders: getEnabledProviders(env).map((p) => p.key),
          hasTelegramToken: !!env.TELEGRAM_BOT_TOKEN,
          hasWebhookSecret: !!env.TELEGRAM_WEBHOOK_SECRET,
          hasBitlyToken: !!env.BITLY_TOKEN,
          hasCuttlyKey: !!env.CUTTLY_API_KEY,
          hasD1: !!env.LINK_DB,
        });
      }

      if (request.method === "GET" && url.pathname === "/init") {
        if (!env.LINK_DB) {
          return json({ ok: false, error: "Missing LINK_DB binding" }, 500);
        }

        await env.LINK_DB.prepare(`
          CREATE TABLE IF NOT EXISTS pending_links (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            user_id TEXT,
            created_at INTEGER NOT NULL
          )
        `).run();

        await env.LINK_DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_pending_created_at
          ON pending_links(created_at)
        `).run();

        return json({ ok: true, initialized: true });
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      if (url.pathname !== "/webhook") {
        return new Response("Not Found", { status: 404 });
      }

      if (!env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, 500);
      }

      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const incomingSecret =
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";

        if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }
      }

      const update = await request.json();
      await handleTelegramUpdate(update, env);

      return json({ ok: true });
    } catch (error) {
      console.error(
        "Top-level fetch error:",
        error && error.stack ? error.stack : error
      );

      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  },
};

async function handleTelegramUpdate(update, env) {
  if (update.message) {
    await handleMessage(update.message, env);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return;
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat?.id;
  const text = message.text?.trim();
  const userId = message.from?.id;
  const firstName = message.from?.first_name || "there";

  if (!chatId || !text) return;

  if (text === "/start") {
    await sendMessage(
      env,
      chatId,
      [
        `✨ Welcome, ${escapeHtml(firstName)}.`,
        ``,
        `Send me any valid link and I’ll turn it into a cleaner, share-ready short URL.`,
        ``,
        `You’ll be able to choose your preferred shortening service before I generate it.`,
        ``,
        `Example: <code>https://www.google.com</code>`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(
      env,
      chatId,
      [
        `🛠️ Here’s how it works:`,
        ``,
        `1. Send me a valid URL`,
        `2. Choose your preferred shortening service`,
        `3. Get your short link instantly`,
        ``,
        `Clean, fast, and simple.`,
      ].join("\n")
    );
    return;
  }

  if (!isValidHttpUrl(text)) {
    await sendMessage(
      env,
      chatId,
      `⚠️ That doesn’t look like a valid link.\n\nPlease send a full URL, for example:\n<code>https://example.com/page</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const providers = getEnabledProviders(env);
  if (!providers.length) {
    await sendMessage(
      env,
      chatId,
      `⚠️ No shortening services are currently available. Please try again later.`
    );
    return;
  }

  if (!env.LINK_DB) {
    await sendMessage(
      env,
      chatId,
      `⚠️ The service is temporarily unavailable. Please try again later.`
    );
    return;
  }

  const pendingId = crypto.randomUUID();
  const createdAt = Date.now();

  await env.LINK_DB.prepare(
    `INSERT INTO pending_links (id, url, chat_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      pendingId,
      text,
      String(chatId),
      userId ? String(userId) : null,
      createdAt
    )
    .run();

  const inline_keyboard = chunkButtons(
    providers.map((provider) => ({
      text: provider.label,
      callback_data: `shorten|${provider.key}|${pendingId}`,
    })),
    2
  );

  await sendMessage(
    env,
    chatId,
    [
      `🔗 <b>Link received</b>`,
      ``,
      `<code>${escapeHtml(text)}</code>`,
      ``,
      `Choose how you’d like to shorten it:`,
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard },
      disable_web_page_preview: true,
    }
  );
}

async function handleCallbackQuery(callbackQuery, env) {
  const callbackId = callbackQuery.id;
  const fromId = callbackQuery.from?.id;
  const message = callbackQuery.message;
  const data = callbackQuery.data || "";

  if (!message?.chat?.id || !message.message_id) {
    await answerCallbackQuery(env, callbackId, "Invalid callback context.");
    return;
  }

  const [action, providerKey, pendingId] = data.split("|");
  if (action !== "shorten" || !providerKey || !pendingId) {
    await answerCallbackQuery(env, callbackId, "Invalid action.");
    return;
  }

  if (!env.LINK_DB) {
    await answerCallbackQuery(env, callbackId, "Service unavailable.");
    return;
  }

  const row = await env.LINK_DB.prepare(
    `SELECT id, url, chat_id, user_id, created_at
     FROM pending_links
     WHERE id = ?`
  )
    .bind(pendingId)
    .first();

  if (!row) {
    await answerCallbackQuery(
      env,
      callbackId,
      "⏳ This request has expired. Please send your link again."
    );

    await editMessageText(
      env,
      message.chat.id,
      message.message_id,
      `⏳ This request has expired.\n\nPlease send your link again to continue.`
    );
    return;
  }

  if (row.user_id && fromId && row.user_id !== String(fromId)) {
    await answerCallbackQuery(
      env,
      callbackId,
      "🔒 This action belongs to another user's request."
    );
    return;
  }

  const provider = getProviderByKey(providerKey, env);
  if (!provider) {
    await answerCallbackQuery(
      env,
      callbackId,
      "⚠️ That service is currently unavailable."
    );
    return;
  }

  await answerCallbackQuery(
    env,
    callbackId,
    `✨ Creating your short link with ${provider.label}...`
  );

  try {
    const shortUrl = await provider.shorten(row.url, env);

    await env.LINK_DB.prepare(`DELETE FROM pending_links WHERE id = ?`)
      .bind(pendingId)
      .run();

    await cleanupOldPending(env);

    await editMessageText(
      env,
      message.chat.id,
      message.message_id,
      [
        `✅ <b>Your short link is ready</b>`,
        ``,
        `<b>Service:</b> ${escapeHtml(provider.label)}`,
        ``,
        `<b>Original link</b>`,
        `<code>${escapeHtml(row.url)}</code>`,
        ``,
        `<b>Short link</b>`,
        `<code>${escapeHtml(shortUrl)}</code>`,
        ``,
        `🚀 Ready to share.`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }
    );
  } catch (error) {
    await editMessageText(
      env,
      message.chat.id,
      message.message_id,
      [
        `❌ <b>We couldn’t generate your short link</b>`,
        ``,
        `<b>Service:</b> ${escapeHtml(provider.label)}`,
        ``,
        `<b>Reason:</b> <code>${escapeHtml(
          error instanceof Error ? error.message : String(error)
        )}</code>`,
        ``,
        `Please send your link again and choose a different service.`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  }
}

async function cleanupOldPending(env) {
  if (!env.LINK_DB) return;

  const cutoff = Date.now() - 1000 * 60 * 60 * 24;

  try {
    await env.LINK_DB.prepare(
      `DELETE FROM pending_links WHERE created_at < ?`
    )
      .bind(cutoff)
      .run();
  } catch (e) {
    console.error("cleanupOldPending failed:", e);
  }
}

function getEnabledProviders(env) {
  const defaultList = [
    "bitly",
    "tinyurl",
    "isgd",
    "vgd",
    "cuttly",
    "cleanuri",
    "shorturlat",
  ];
  let enabled = defaultList;

  if (env.ENABLED_PROVIDERS) {
    try {
      const parsed = JSON.parse(env.ENABLED_PROVIDERS);
      if (Array.isArray(parsed)) {
        enabled = parsed.map((x) => String(x).toLowerCase());
      }
    } catch {
      enabled = String(env.ENABLED_PROVIDERS)
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return buildProviders(env).filter((p) => enabled.includes(p.key));
}

function getProviderByKey(key, env) {
  return getEnabledProviders(env).find(
    (p) => p.key === String(key).toLowerCase()
  );
}

function buildProviders(env) {
  return [
    {
      key: "bitly",
      label: "✨ Bitly",
      shorten: async (longUrl, env) => {
        if (!env.BITLY_TOKEN) {
          throw new Error("BITLY_TOKEN is not configured.");
        }

        const response = await fetch("https://api-ssl.bitly.com/v4/shorten", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.BITLY_TOKEN}`,
          },
          body: JSON.stringify({ long_url: longUrl }),
        });

        const data = await safeJson(response);
        if (!response.ok) {
          throw new Error(data?.message || `Bitly HTTP ${response.status}`);
        }
        if (!data?.link) {
          throw new Error("Bitly did not return a short link.");
        }

        return data.link;
      },
    },
    {
      key: "tinyurl",
      label: "⚡ TinyURL",
      shorten: async (longUrl) => {
        const response = await fetch(
          "https://tinyurl.com/api-create.php?url=" + encodeURIComponent(longUrl)
        );
        const text = (await response.text()).trim();

        if (!response.ok) {
          throw new Error(text || `TinyURL HTTP ${response.status}`);
        }
        if (!isLikelyUrl(text)) {
          throw new Error(text || "TinyURL did not return a valid URL.");
        }

        return text;
      },
    },
    {
      key: "isgd",
      label: "🔹 is.gd",
      shorten: async (longUrl) => {
        const response = await fetch(
          "https://is.gd/create.php?format=simple&url=" + encodeURIComponent(longUrl)
        );
        const text = (await response.text()).trim();

        if (!response.ok) {
          throw new Error(text || `is.gd HTTP ${response.status}`);
        }
        if (!isLikelyUrl(text)) {
          throw new Error(text || "is.gd did not return a valid URL.");
        }

        return text;
      },
    },
    {
      key: "vgd",
      label: "🌐 v.gd",
      shorten: async (longUrl) => {
        const response = await fetch(
          "https://v.gd/create.php?format=simple&url=" + encodeURIComponent(longUrl)
        );
        const text = (await response.text()).trim();

        if (!response.ok) {
          throw new Error(text || `v.gd HTTP ${response.status}`);
        }
        if (!isLikelyUrl(text)) {
          throw new Error(text || "v.gd did not return a valid URL.");
        }

        return text;
      },
    },
    {
      key: "cuttly",
      label: "✂️ Cuttly",
      shorten: async (longUrl, env) => {
        if (!env.CUTTLY_API_KEY) {
          throw new Error("CUTTLY_API_KEY is not configured.");
        }

        const endpoint =
          "https://cutt.ly/api/api.php?key=" +
          encodeURIComponent(env.CUTTLY_API_KEY) +
          "&short=" +
          encodeURIComponent(longUrl);

        const response = await fetch(endpoint, { method: "GET" });
        const data = await safeJson(response);

        if (!response.ok) {
          throw new Error(`Cuttly HTTP ${response.status}`);
        }

        const result = data?.url;
        if (!result) {
          throw new Error("Cuttly did not return a response payload.");
        }

        if (result.status === 7 && result.shortLink) {
          return result.shortLink;
        }

        if (result.status === 1) {
          throw new Error("The link has already been shortened.");
        }
        if (result.status === 2) {
          throw new Error("The entered link is not a valid URL.");
        }
        if (result.status === 3) {
          throw new Error("The preferred alias is already in use.");
        }
        if (result.status === 4) {
          throw new Error("The API key is invalid.");
        }
        if (result.status === 5) {
          throw new Error("The link may contain blocked or invalid content.");
        }
        if (result.status === 6) {
          throw new Error("The link has not passed validation.");
        }

        throw new Error("Cuttly failed to generate a short link.");
      },
    },
    {
      key: "cleanuri",
      label: "🧼 CleanURI",
      shorten: async (longUrl) => {
        const response = await fetch("https://cleanuri.com/api/v1/shorten", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ url: longUrl }).toString(),
        });

        const data = await safeJson(response);
        if (!response.ok) {
          throw new Error(data?.error || `CleanURI HTTP ${response.status}`);
        }

        const shortUrl = data?.result_url || data?.shortenedUrl || data?.url;
        if (!shortUrl) {
          throw new Error("CleanURI did not return a short link.");
        }

        return shortUrl;
      },
    },
    {
      key: "shorturlat",
      label: "🟠 ShortURL.at",
      shorten: async (longUrl) => {
        const formBodies = [
          new URLSearchParams({ url: longUrl }).toString(),
          new URLSearchParams({ u: longUrl }).toString(),
          new URLSearchParams({ longurl: longUrl }).toString(),
        ];

        let lastError = "ShortURL.at did not return a usable short link.";

        for (const body of formBodies) {
          const response = await fetch("https://www.shorturl.at/shortener.php", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Origin: "https://www.shorturl.at",
              Referer: "https://www.shorturl.at/",
              "User-Agent": "Mozilla/5.0",
            },
            body,
            redirect: "follow",
          });

          const html = await response.text();

          if (!response.ok) {
            lastError = html || `ShortURL.at HTTP ${response.status}`;
            continue;
          }

          const errorSignals = [
            "An error occurred creating the short URL",
            "The URL has not been shortened",
          ];

          if (errorSignals.some((s) => html.includes(s))) {
            const cleaned = html
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            lastError =
              cleaned.match(/The URL has not been shortened.*$/i)?.[0] ||
              "ShortURL.at rejected this URL.";
            continue;
          }

          const matches = [
            ...html.matchAll(/https:\/\/shorturl\.at\/[A-Za-z0-9]+/g),
            ...html.matchAll(/https:\/\/www\.shorturl\.at\/[A-Za-z0-9]+/g),
          ].map((m) => m[0]);

          const unique = [...new Set(matches)].filter(
            (u) =>
              !u.includes("/shortener.php") &&
              !u.includes("/url-error.php") &&
              !u.endsWith("/shorturl.at/")
          );

          if (unique.length) {
            return unique[0].replace(
              "https://www.shorturl.at/",
              "https://shorturl.at/"
            );
          }

          lastError =
            "ShortURL.at page loaded, but no short link could be extracted.";
        }

        throw new Error(lastError);
      },
    },
  ];
}

async function telegram(env, method, payload) {
  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await safeJson(response);

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.description || `Telegram API error (${response.status})`
    );
  }

  return data.result;
}

function sendMessage(env, chatId, text, extra = {}) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

function editMessageText(env, chatId, messageId, text, extra = {}) {
  return telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra,
  });
}

function answerCallbackQuery(env, callbackQueryId, text) {
  return telegram(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function chunkButtons(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
