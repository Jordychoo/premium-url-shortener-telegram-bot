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
                    hasLnkuaKey: !!env.LNKUA_API_KEY,
                    hasTinyccUser: !!env.TINYCC_USER,
                    hasTinyccKey: !!env.TINYCC_API_KEY,
                    hasSpoomeKey: !!env.SPOOME_API_KEY,
                    hasGooSuToken: !!env.GOOSU_API_TOKEN,
                    hasReurlccKey: !!env.REURLCC_API_KEY,
                    hasPicseeToken: !!env.PICSEE_ACCESS_TOKEN,
                    hasLinklyhqKey: !!env.LINKLYHQ_API_KEY,
                    hasShortenworldKey: !!env.SHORTENWORLD_API_KEY,
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

            if (request.method === "OPTIONS" && url.pathname === "/api/shorten") {
                return new Response(null, {
                    status: 204,
                    headers: corsHeaders(),
                });
            }

            if (request.method === "POST" && url.pathname === "/api/shorten") {
                return await handleApiShorten(request, env);
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

async function handleApiShorten(request, env) {
    let body;

    try {
        body = await request.json();
    } catch {
        return apiJson({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const longUrl = String(body?.url || "").trim();
    const providerKey = String(body?.provider || "").trim().toLowerCase();

    if (!isValidHttpUrl(longUrl)) {
        return apiJson({ ok: false, error: "Invalid URL." }, 400);
    }

    if (!providerKey) {
        return apiJson({ ok: false, error: "Provider is required." }, 400);
    }

    const provider = getProviderByKey(providerKey, env);

    if (!provider) {
        return apiJson({ ok: false, error: "Unknown or disabled provider." }, 400);
    }

    try {
        const shortUrl = await provider.shorten(longUrl, env);

        return apiJson({
            ok: true,
            provider: provider.key,
            original_url: longUrl,
            short_url: shortUrl,
        });
    } catch (error) {
        return apiJson(
            {
                ok: false,
                provider: provider.key,
                error: error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
}

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
        "lnkua",
        "cuttly",
        "cleanuri",
        "shorturlat",
        "spoome",
        "tinycc",
        "tinube",
        "yasosu",
        "goosu",
        "urliinfo",
        "scnst",
        "shortlinkme",
        "treee",
        "n9cl",
        "h1nu",
        "comeac",
        "shorterme",
        "reurlcc",
        "picsee",
        "linklyhq",
        "shortenworldapi",
        "centi",
        "shortens",
        "shortenworld",
        "swrun",
        "shortenas",
        "shortenis",
        "shortentv",
        "shortenso",
        "shortenee",
        "clckru",
        "osdb",
        "ulvis"
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
            key: "lnkua",
            label: "🇺🇦 lnk.ua",
            shorten: async (longUrl, env) => {
                if (!env.LNKUA_API_KEY) {
                    throw new Error("LNKUA_API_KEY is not configured.");
                }

                const form = new FormData();
                form.append("link", longUrl);

                const response = await fetch("https://lnk.ua/api/v1/link/create", {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${env.LNKUA_API_KEY}`,
                    },
                    body: form,
                });

                const data = await safeJson(response);

                if (!response.ok) {
                    throw new Error(
                        data?.message ||
                        data?.error ||
                        data?.result?.message ||
                        `lnk.ua HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.result?.lnk;

                if (!shortUrl) {
                    throw new Error("lnk.ua did not return a short link.");
                }

                return shortUrl;
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

                const response = await fetch(endpoint);
                const data = await safeJson(response);

                const result = data?.url;

                if (!response.ok || !result) {
                    throw new Error("Cuttly request failed.");
                }

                const messages = {
                    1: "The link has already been shortened.",
                    2: "The entered link is not a valid URL.",
                    3: "The preferred alias is already in use.",
                    4: "The API key is invalid.",
                    5: "The link may contain blocked or invalid content.",
                    6: "The link has not passed validation.",
                };

                if (result.status === 7 && result.shortLink) {
                    return result.shortLink;
                }

                throw new Error(messages[result.status] || "Cuttly failed to generate a short link.");
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
                const body = new URLSearchParams({
                    u: longUrl, // IMPORTANT: it's "u", not "url"
                });

                const response = await fetch("https://www.shorturl.at/shortener.php", {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "user-agent": "Mozilla/5.0",
                        "origin": "https://www.shorturl.at",
                        "referer": "https://www.shorturl.at/",
                    },
                    body: body.toString(),
                    redirect: "follow",
                });

                const html = await response.text();

                if (!response.ok) {
                    throw new Error(`ShortURL.at HTTP ${response.status}`);
                }

                // Extract from input value
                const match = html.match(
                    /id=["']shortenurl["'][^>]*value=["']([^"']+)["']/i
                );

                if (match?.[1]) {
                    return match[1];
                }

                // fallback regex (in case layout changes)
                const fallback = html.match(
                    /https:\/\/shorturl\.at\/[A-Za-z0-9]+/i
                );

                if (fallback?.[0]) return fallback[0];

                throw new Error("ShortURL.at did not return a short link.");
            },
        },

        {
            key: "spoome",
            label: "🟣 spoo.me",
            shorten: async (longUrl, env) => {
                if (!env.SPOOME_API_KEY) {
                    throw new Error("SPOOME_API_KEY is not configured.");
                }

                const response = await fetch("https://spoo.me/api/v1/shorten", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${env.SPOOME_API_KEY}`,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({ long_url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok) {
                    throw new Error(
                        data?.error?.message ||
                        data?.message ||
                        `spoo.me HTTP ${response.status}`
                    );
                }

                const shortUrl =
                    data?.short_url ||
                    data?.data?.short_url;

                if (!shortUrl) {
                    throw new Error("spoo.me did not return a short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "tinycc",
            label: "🔵 Tiny.cc",
            shorten: async (longUrl, env) => {
                if (!env.TINYCC_USER) {
                    throw new Error("TINYCC_USER is not configured.");
                }
                if (!env.TINYCC_API_KEY) {
                    throw new Error("TINYCC_API_KEY is not configured.");
                }

                const basicAuth = btoa(`${env.TINYCC_USER}:${env.TINYCC_API_KEY}`);

                const response = await fetch("https://tiny.cc/tiny/api/3/urls", {
                    method: "POST",
                    headers: {
                        Authorization: `Basic ${basicAuth}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        urls: [{ long_url: longUrl }],
                    }),
                });

                const data = await safeJson(response);

                const getError = (e) =>
                    e?.message ||
                    e?.details ||
                    "Tiny.cc error";

                if (!response.ok) {
                    throw new Error(
                        getError(data?.error) ||
                        `HTTP ${response.status}`
                    );
                }

                if (data?.error?.code && data.error.code !== 0) {
                    throw new Error(getError(data.error));
                }

                const row = data?.urls?.[0];

                if (!row) {
                    throw new Error("Tiny.cc did not return a URL payload.");
                }

                if (row?.error?.code && row.error.code !== 0) {
                    throw new Error(getError(row.error));
                }

                const shortUrl =
                    row?.short_url_with_protocol ||
                    row?.short_url ||
                    row?.url;

                if (!shortUrl) {
                    throw new Error("Tiny.cc did not return a short link.");
                }

                return shortUrl.startsWith("http")
                    ? shortUrl
                    : `https://${shortUrl}`;
            },
        },

        {
            key: "tinube",
            label: "🟢 tinu.be",
            shorten: async (longUrl) => {
                const payload = JSON.stringify([{ longUrl, urlCode: "" }]);

                const response = await fetch("https://tinu.be/en", {
                    method: "POST",
                    headers: {
                        Accept: "text/x-component",
                        "Content-Type": "text/plain;charset=UTF-8",
                        Origin: "https://tinu.be",
                        Referer: "https://tinu.be/en",
                        "Next-Action": "74b2f223fe2b6e65737e07eeabae72c67abf76b2",
                        "User-Agent": "Mozilla/5.0",
                    },
                    body: payload,
                });

                const text = await response.text();

                if (!response.ok) {
                    throw new Error(text || `tinu.be HTTP ${response.status}`);
                }

                const code =
                    text.match(/"urlCode":"([^"]+)"/)?.[1];

                if (!code) {
                    throw new Error("tinu.be did not return a short code.");
                }

                return `https://tinu.be/${code}`;
            },
        },

        {
            key: "yasosu",
            label: "🟡 yaso.su",
            shorten: async (longUrl) => {
                const response = await fetch("https://api.yaso.su/records", {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        Origin: "https://yaso.su",
                        Referer: "https://yaso.su/",
                        "User-Agent": "Mozilla/5.0",
                        Cookie: "yasosu_session=ys-web-8PGCHo7TuvXgRsKW9Td6DKLcv6JTJgdrfcZsqKYxcmWb",
                    },
                    body: JSON.stringify({
                        expirationTime: -1,
                        content: longUrl,
                        captcha: "DO_NOT_USE_WAIT_FOR_PUBLIC_API",
                    }),
                });

                const data = await safeJson(response);

                if (!response.ok) {
                    throw new Error(
                        data?.message ||
                        data?.error ||
                        data?.details ||
                        `yaso.su HTTP ${response.status}`
                    );
                }

                if (data?.contentType !== "url" || !data?.url) {
                    throw new Error("yaso.su did not return a valid URL record.");
                }

                return `https://yaso.su/${data.url}`;
            },
        },

        {
            key: "goosu",
            label: "🟤 Goo.su",
            shorten: async (longUrl, env) => {
                if (!env.GOOSU_API_TOKEN) {
                    throw new Error("GOOSU_API_TOKEN is not configured.");
                }

                const response = await fetch("https://goo.su/api/links/create", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "X-Goo-Api-Token": env.GOOSU_API_TOKEN,
                    },
                    body: JSON.stringify({
                        url: longUrl,
                        is_public: true,
                    }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.successful === false) {
                    throw new Error(
                        data?.message ||
                        data?.error ||
                        `Goo.su HTTP ${response.status}`
                    );
                }

                const shortUrl =
                    data?.short_url ||
                    data?.link?.short_url ||
                    data?.link?.short;

                if (!shortUrl) {
                    throw new Error("Goo.su did not return a short link.");
                }

                return shortUrl.startsWith("http")
                    ? shortUrl
                    : `https://goo.su/${shortUrl}`;
            },
        },

        {
            key: "urliinfo",
            label: "🟠 urli.info",
            shorten: async (longUrl) => {
                const response = await fetch("https://urli.info/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Origin: "https://urli.info",
                        Referer: "https://urli.info/",
                        "User-Agent": "Mozilla/5.0",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                    redirect: "follow",
                });

                const html = await response.text();

                if (!response.ok) {
                    throw new Error(html || `urli.info HTTP ${response.status}`);
                }

                const match = html.match(
                    /<input[^>]*class=["'][^"']*short-url[^"']*["'][^>]*value=["']([^"']+)["']/i
                );

                const shortUrl = match?.[1];

                if (shortUrl && isLikelyUrl(shortUrl)) {
                    return shortUrl;
                }

                throw new Error("urli.info did not return a usable short link.");
            },
        },

        {
            key: "scnst",
            label: "⚫ scn.st",
            shorten: async (longUrl) => {
                const response = await fetch("https://scn.st/api/link/create", {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        Cookie: "scn_auth=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ2cTg0bWdwMCIsInRpZXIiOiJmcmVlIiwiaWF0IjoxNzc1OTMzNTA3LCJleHAiOjE3NzYxMDYzMDd9.pzNTxg7sD0YbwQg5qKb5GPgDccnUEPyx6i0Onvx8kKk",
                    },
                    body: JSON.stringify({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok) {
                    throw new Error(
                        data?.message ||
                        data?.error ||
                        `scn.st HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.shortLink;

                if (!shortUrl) {
                    throw new Error("scn.st did not return a short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortlinkme",
            label: "🟣 short-link.me",
            shorten: async (longUrl) => {
                const response = await fetch("https://short-link.me/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Origin: "https://short-link.me",
                        Referer: "https://short-link.me/",
                        "User-Agent": "Mozilla/5.0",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                    redirect: "follow",
                });

                const html = await response.text();

                if (!response.ok) {
                    throw new Error(html || `short-link.me HTTP ${response.status}`);
                }

                const match = html.match(
                    /<input[^>]*class=["'][^"']*short-url[^"']*["'][^>]*value=["']([^"']+)["']/i
                );

                const shortUrl = match?.[1];

                if (shortUrl && isLikelyUrl(shortUrl)) {
                    return shortUrl;
                }

                throw new Error("short-link.me did not return a usable short link.");
            },
        },

        {
            key: "treee",
            label: "🌲 tr.ee",
            shorten: async (longUrl) => {
                const response = await fetch("https://tr.ee/", {
                    method: "POST",
                    headers: {
                        Accept: "text/x-component",
                        "Content-Type": "text/plain;charset=UTF-8",
                        Origin: "https://tr.ee",
                        Referer: "https://tr.ee/",
                        "Next-Action": "40dc4e220b2ab91d6cc61231e2febe5e57eb5b9c05",
                        "Next-Router-State-Tree":
                            '["",{"children":["(site)",{"children":["(home)",{"children":["__PAGE__",{},null,null,0],"faqs":["__DEFAULT__",{},null,null,0]},null,null,4],"auth":["__DEFAULT__",{},null,null,0],"footer":["__DEFAULT__",{},null,null,0],"header":["__DEFAULT__",{},null,null,0],"pinned":["__DEFAULT__",{},null,null,0]},null,null,8]},null,null,24]',
                        "User-Agent": "Mozilla/5.0",
                    },
                    body: JSON.stringify([{ url: longUrl }]),
                });

                const text = await response.text();

                if (!response.ok) {
                    throw new Error(text || `tr.ee HTTP ${response.status}`);
                }

                const slug =
                    text.match(/\/short-link\/([A-Za-z0-9_-]{4,20})/)?.[1] ||
                    text.match(/https:\/\/tr\.ee\/([A-Za-z0-9_-]{4,20})/)?.[1];

                if (!slug) {
                    throw new Error("tr.ee did not return a usable short link.");
                }

                return `https://tr.ee/${slug}`;
            },
        },

        {
            key: "n9cl",
            label: "🟢 n9.cl",
            shorten: async (longUrl) => {
                const body = new URLSearchParams({
                    xjxfun: "create",
                    xjxr: Date.now().toString(),
                    "xjxargs[]": `S<![CDATA[${longUrl}]]>`,
                });

                const response = await fetch("https://n9.cl/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Accept: "*/*",
                        Origin: "https://n9.cl",
                        Referer: "https://n9.cl/",
                        "User-Agent": "Mozilla/5.0",
                    },
                    body,
                });

                const text = await response.text();

                if (!response.ok) {
                    throw new Error(text || `n9.cl HTTP ${response.status}`);
                }

                const match = text.match(
                    /window\.location\s*=\s*"https:\/\/n9\.cl\/[a-z]{2}\/r\/([A-Za-z0-9]+)"/i
                );

                if (!match?.[1]) {
                    throw new Error("n9.cl did not return a usable short link.");
                }

                return `https://n9.cl/${match[1]}`;
            },
        },

        {
            key: "h1nu",
            label: "⚪ h1.nu",
            shorten: async (longUrl) => {
                const response = await fetch("https://h1.nu/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Origin: "https://h1.nu",
                        Referer: "https://h1.nu/",
                        "User-Agent": "Mozilla/5.0",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                    redirect: "follow",
                });

                const html = await response.text();

                if (!response.ok) {
                    throw new Error(html || `h1.nu HTTP ${response.status}`);
                }

                const shortUrl =
                    html.match(/<input[^>]*class=["'][^"']*short-url[^"']*["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
                    html.match(/https:\/\/h1\.nu\/[A-Za-z0-9]+/)?.[0];

                if (shortUrl && isLikelyUrl(shortUrl)) {
                    return shortUrl;
                }

                throw new Error("h1.nu did not return a usable short link.");
            },
        },

        {
            key: "comeac",
            label: "🔵 come.ac",
            shorten: async (longUrl) => {
                const response = await fetch("https://come.ac/page/shorten-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://come.ac",
                        Referer: "https://come.ac/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `come.ac HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("come.ac did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shorterme",
            label: "🟣 Shorter.me",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorter.me/page/shorten", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorter.me",
                        Referer: "https://shorter.me/",
                        "User-Agent": "Mozilla/5.0",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `Shorter.me HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("Shorter.me did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "reurlcc",
            label: "🔗 Reurl.cc",
            shorten: async (longUrl, env) => {
                if (!env.REURLCC_API_KEY) {
                    throw new Error("REURLCC_API_KEY is not configured.");
                }

                const response = await fetch("https://api.reurl.cc/shorten", {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "reurl-api-key": env.REURLCC_API_KEY,
                    },
                    body: JSON.stringify({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok) {
                    throw new Error(data?.message || data?.res || `Reurl HTTP ${response.status}`);
                }

                if (!data?.short_url) {
                    throw new Error("Reurl did not return a short link.");
                }

                return data.short_url;
            },
        },

        {
            key: "picsee",
            label: "✨ PicSee",
            shorten: async (longUrl, env) => {
                if (!env.PICSEE_ACCESS_TOKEN) {
                    throw new Error("PICSEE_ACCESS_TOKEN is not configured.");
                }

                const response = await fetch(
                    `https://api.pics.ee/v1/links?access_token=${env.PICSEE_ACCESS_TOKEN}`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            accept: "application/json",
                        },
                        body: JSON.stringify({ url: longUrl }),
                    }
                );

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data?.meta?.message || `PicSee HTTP ${response.status}`);
                }

                const shortUrl = data?.data?.picseeUrl;
                if (!shortUrl) throw new Error("PicSee did not return picseeUrl.");

                return shortUrl;
            },
        },

        {
            key: "linklyhq",
            label: "🔗 LinklyHQ",
            shorten: async (longUrl, env) => {
                if (!env.LINKLYHQ_API_KEY) {
                    throw new Error("LINKLYHQ_API_KEY is not configured.");
                }

                const params = new URLSearchParams({
                    api_key: env.LINKLYHQ_API_KEY,
                    workspace_id: env.LINKLYHQ_WORKSPACE_ID || "372573",
                    url: longUrl,
                    name: "Short Link",
                });

                const response = await fetch("https://app.linklyhq.com/api/v1/link", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Accept: "application/json",
                    },
                    body: params,
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data?.message || `LinklyHQ HTTP ${response.status}`);
                }

                const shortUrl = data?.full_url;

                if (!shortUrl) {
                    throw new Error("LinklyHQ did not return a short URL.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortenworldapi",
            label: "🌍 ShortenWorld",

            shorten: async (longUrl, env) => {
                const API_BASE = "https://api.shortenworld.com/v1";

                const USERNAME = env.SHORTENWORLD_USERNAME;
                const API_KEY = env.SHORTENWORLD_API_KEY;
                const TEAM_ID = env.SHORTENWORLD_TEAM_ID;
                const DOMAIN_ID = env.SHORTENWORLD_DOMAIN_ID;

                if (!USERNAME || !API_KEY) {
                    throw new Error("Missing ShortenWorld credentials.");
                }

                if (!TEAM_ID || !DOMAIN_ID) {
                    throw new Error("Missing TEAM_ID or DOMAIN_ID.");
                }

                // ✅ validate URL (IMPORTANT)
                try {
                    new URL(longUrl);
                } catch {
                    throw new Error("Invalid URL format.");
                }

                // ---- AUTH ----
                const authRes = await fetch(`${API_BASE}/authen/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        username: USERNAME,
                        key: API_KEY,
                    }),
                });

                const authData = await authRes.json();

                if (!authRes.ok) {
                    throw new Error(authData?.message || `Auth failed (${authRes.status})`);
                }

                const accessToken = authData?.token?.access_token;

                if (!accessToken) {
                    throw new Error("Missing access token.");
                }

                // ---- SHORTEN ----
                const res = await fetch(`${API_BASE}/entity/link/create`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                        teamId: TEAM_ID,
                        domainId: DOMAIN_ID,
                        campaignId: "",
                        noTitle: false,
                        destination: longUrl,
                    }),
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data?.status?.message || data?.message || `HTTP ${res.status}`);
                }

                // ✅ correct field from real API response
                const shortUrl = data?.linkShort;

                if (!shortUrl) {
                    throw new Error("No short URL returned from API.");
                }

                return shortUrl;
            },
        },

        {
            key: "centi",
            label: "🔵 centi.ai",
            shorten: async (longUrl) => {
                const response = await fetch("https://centi.ai/page/shorten-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://centi.ai",
                        Referer: "https://centi.ai/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `centi.ai HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("centi.ai did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortens",
            label: "🟣 shortens.org",
            shorten: async (longUrl) => {
                const response = await fetch("https://shortens.org/page/shorten-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shortens.org",
                        Referer: "https://shortens.org/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shortens.org HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shortens.org did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortenworld",
            label: "🌐 shorten.world",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorten.world/page/shorten-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorten.world",
                        Referer: "https://shorten.world/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shorten.world HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shorten.world did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "swrun",
            label: "⚡ sw.run",
            shorten: async (longUrl) => {
                const response = await fetch("https://sw.run/page/shorten-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://sw.run",
                        Referer: "https://sw.run/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `sw.run HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("sw.run did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortenas",
            label: "🟡 shorten.as",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorten.as/page/shorten-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorten.as",
                        Referer: "https://shorten.as/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shorten.as HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shorten.as did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortenis",
            label: "⚫ shorten.is",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorten.is/page/shorten", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorten.is",
                        Referer: "https://shorten.is/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shorten.is HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shorten.is did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortentv",
            label: "📺 shorten.tv",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorten.tv/page/shorten", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorten.tv",
                        Referer: "https://shorten.tv/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shorten.tv HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shorten.tv did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortenso",
            label: "🟠 shorten.so",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorten.so/page/shorten", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorten.so",
                        Referer: "https://shorten.so/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shorten.so HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shorten.so did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "shortenee",
            label: "🟢 shorten.ee",
            shorten: async (longUrl) => {
                const response = await fetch("https://shorten.ee/page/shorten", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        Origin: "https://shorten.ee",
                        Referer: "https://shorten.ee/",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const data = await safeJson(response);

                if (!response.ok || data?.code !== 0) {
                    throw new Error(
                        data?.message ||
                        `shorten.ee HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("shorten.ee did not return a valid short link.");
                }

                return shortUrl;
            },
        },

        {
            key: "clckru",
            label: "🟣 clck.ru",
            shorten: async (longUrl) => {
                const response = await fetch(
                    "https://clck.ru/--?url=" + encodeURIComponent(longUrl)
                );

                const text = (await response.text()).trim();

                if (!response.ok || !isLikelyUrl(text)) {
                    throw new Error(text || "clck.ru did not return a valid URL.");
                }

                return text;
            },
        },

        {
            key: "osdb",
            label: "🟢 osdb.link",
            shorten: async (longUrl) => {
                const response = await fetch("https://osdb.link/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({ url: longUrl }),
                });

                const html = await response.text();

                if (!response.ok) {
                    throw new Error(`osdb.link HTTP ${response.status}`);
                }

                const match = html.match(/https?:\/\/osdb\.link\/[A-Za-z0-9]+/);

                if (!match) {
                    throw new Error("osdb.link did not return a valid short URL.");
                }

                return match[0];
            },
        },

        {
            key: "ulvis",
            label: "🟢 Ulvis",
            shorten: async (longUrl) => {
                const response = await fetch(
                    "https://ulvis.net/API/write/get?url=" + encodeURIComponent(longUrl)
                );

                const data = await safeJson(response);

                if (!response.ok || !data?.success) {
                    throw new Error(
                        data?.message ||
                        `Ulvis HTTP ${response.status}`
                    );
                }

                const shortUrl = data?.data?.url;

                if (!shortUrl || !isLikelyUrl(shortUrl)) {
                    throw new Error("Ulvis did not return a valid short link.");
                }

                return shortUrl;
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

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function apiJson(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders(),
        },
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });
}