import { getUser, saveUserStep } from "./db.js";
import { buildDcaKeyboard, buildLimitOrderKeyboard } from "./handleLimitKeyboard.js";
import { shortAddress } from "./shortAddress.js";

export function parseDurationToMinutes(input) {
    const normalized = input.trim().toLowerCase();

    // Match all duration parts like 1d, 12h, 30m in a row
    const matches = normalized.match(/(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/g);
    if (!matches) return null;

    let totalMinutes = 0;

    for (const part of matches) {
        const match = part.match(/(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/);
        if (!match) continue;

        const value = parseInt(match[1], 10);
        const unit = match[2];

        switch (unit) {
            case "d":
            case "day":
            case "days":
                totalMinutes += value * 1440;
                break;
            case "h":
            case "hr":
            case "hrs":
            case "hour":
            case "hours":
                totalMinutes += value * 60;
                break;
            case "m":
            case "min":
            case "mins":
            case "minute":
            case "minutes":
                totalMinutes += value;
                break;
        }
    }

    return totalMinutes || null;
}

export async function handleLimitTriggerValueInput(ctx, step) {
    const userId = ctx.from.id;
    const input = ctx.message.text?.trim();
    const value = parseFloat(input);
    if (isNaN(value) || value <= 0) {
        return ctx.reply("❌ Please enter a valid number greater than 0.");
    }
    step.limitTriggerValue = value;
    step.currentFlow = "limit";
    step.state = null;
    const user = await getUser(userId);
    const tokenInfo = step.tokenInfo;
    if (!tokenInfo) {
        return ctx.reply("❌ Missing token information. Please start again.");
    }
    // Normalize wallets and generate walletMap using w0, w1 keys
    const rawWallets = user.wallets || [];
    const wallets = rawWallets
        .filter(w => typeof w === "object" && (w.walletAddress || w.address))
        .map((w, i) => {
            const address = w.walletAddress || w.address;
            return {
                ...w,
                address,
                name: w.name || shortAddress(address),
            };
        });

    const walletMap = wallets.reduce((map, w, i) => {
        const key = `w${i}`;
        map[key] = { ...w, key };
        return map;
    }, {});

    step.wallets = wallets;
    step.walletMap = walletMap;

    // Ensure selectedWallets is using keys like w0, w1
    if (!step.selectedWallets || step.selectedWallets.length === 0) {
        step.selectedWallets = ["w0"];
    }

    const selectedWallets = step.selectedWallets;
    const selectedWalletObjs = selectedWallets.map(k => walletMap[k]).filter(Boolean);

    // Build message
    let text = `To place a limit order for <b>${tokenInfo.symbol}</b>, follow these steps:\n\n`;
    text += `1️⃣ Select the wallets you want to set the order for.\n`;
    text += `2️⃣ Choose a mode — Buy (Take-Profit) or Sell (Stop-Loss).\n`;
    text += `3️⃣ Enter the target market cap or price to trigger the order.\n`;
    text += `4️⃣ Tap one of the buttons to define your order size.\n\n`;

    text += `<b>Selected Wallets:</b>\n`;

    const walletDisplayLines = selectedWalletObjs
        .map((w, i) => {
            const address = w.address || w.walletAddress;
            const explorerLink = `https://suiexplorer.com/address/${address}?network=mainnet`;
            const displayName = w.name || shortAddress(w.address);
            return `💳 <a href="${explorerLink}">${displayName}</a>`;
        })
        .join("\n");

    text += `${walletDisplayLines || "💳 None"}\n\n`;
    text += `📘 <a href="https://example.com/how-to-use">How to Use?</a>`;

    const keyboard = {
        inline_keyboard: buildLimitOrderKeyboard(
            selectedWallets,
            wallets,
            step.mode || "buy",
            value
        ),
    };

    // Attempt to update message
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            step.mainMessageId,
            undefined,
            text,
            {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: keyboard,
            }
        );
    } catch (err) {
        const sent = await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
        if (sent?.message_id) {
            step.mainMessageId = sent.message_id;
        }
    }

    // Cleanup prompts
    if (step.mcapPromptMessageId) {
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, step.mcapPromptMessageId);
        } catch (e) {
            console.warn("Failed to delete MCAP prompt:", e.message);
        }
    }

    try {
        await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {
        console.warn("Failed to delete user reply message:", e.message);
    }

    await saveUserStep(userId, step);
}

export async function handleDcaInput(ctx, step) {
    const userId = ctx.from.id;
    const input = ctx.message.text.trim().toLowerCase();
    const minutes = parseDurationToMinutes(input);
    if (!minutes || minutes < 5) {
        return ctx.reply("❌ Invalid time. Use formats like 30m, 2h, 1d (min 5 mins).");
    }
    // switch (step.state)
    const previousState = step.state; // store BEFORE setting step.state = null

    switch (previousState) {
        case "awaiting_dca_duration":
            step.dcaDurationMinutes = minutes;
            step.dcaDuration = minutes;
            break;
        case "awaiting_dca_interval":
            step.dcaIntervalMinutes = minutes;
            step.dcaInterval = minutes;
            break;
        default:
            return;
    }

    step.state = null;
    const user = await getUser(userId);
    const tokenInfo = step.tokenInfo;
    if (!tokenInfo) {
        return ctx.reply("❌ Missing token information. Please start again.");
    }
    // Normalize wallets
    const rawWallets = user.wallets || [];
    const wallets = rawWallets
        .filter(w => typeof w === "object" && (w.walletAddress || w.address))
        .map((w, i) => {
            const address = w.walletAddress || w.address;
            return {
                ...w,
                address,
                name: w.name || shortAddress(address),
            };
        });
    const walletMap = wallets.reduce((map, w, i) => {
        const key = `w${i}`;
        map[key] = { ...w, key };
        return map;
    }, {});
    step.wallets = wallets;
    step.walletMap = walletMap;
    // Ensure selectedWallets is valid
    if (!step.selectedWallets || step.selectedWallets.length === 0) {
        step.selectedWallets = ["w0"];
    }
    const selectedWalletObjs = step.selectedWallets.map(k => walletMap[k]).filter(Boolean);
    // Build DCA message
    let text = `To place a DCA order for <b>${tokenInfo.symbol}</b>, follow these steps:\n\n`;
    text += `1️⃣ Select the wallets you want to set the order for.\n`;
    text += `2️⃣ Choose a mode — Buy or Sell.\n`;
    text += `3️⃣ Enter the total duration for the DCA strategy.\n`;
    text += `4️⃣ Define the interval between each buy/sell action.\n`;
    text += `5️⃣ Use one of the buttons to determine the total amount of tokens to buy/sell.\n\n`;

    text += `<b>Selected Wallets:</b>\n`;
    selectedWalletObjs.forEach(w => {
        const address = w.address;
        const displayName = w.name || shortAddress(address);
        const explorerWalletLink = `https://suiexplorer.com/address/${address}?network=mainnet`;
        text += `💳 <a href="${explorerWalletLink}">${displayName}</a>\n\n`;
    });


    if (step.dcaDurationMinutes) {
        text += `⏱ Total Duration: ${step.dcaDurationMinutes} minutes\n`;
    }

    if (step.dcaIntervalMinutes) {
        text += `🔁 Interval: ${step.dcaIntervalMinutes} minutes\n`;
    }

    text += `\n📘 <a href="https://example.com/how-to-use">How to Use?</a>`;

    const keyboard = {
        inline_keyboard: buildDcaKeyboard(
            step.selectedWallets || [],
            step.wallets || [],
            step.showAllWallets ?? false,
            step.mode,
            {
                duration: step.dcaDuration,
                interval: step.dcaInterval
            }
        )
    };

    // Try to edit main message
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            step.mainMessageId,
            undefined,
            text,
            {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: keyboard,
            }
        );
    } catch (err) {
        const sent = await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
        if (sent?.message_id) {
            step.mainMessageId = sent.message_id;
        }
    }
    // Cleanup: delete prompt & reply
    const promptId =
        previousState === "awaiting_dca_duration"
            ? step.dcaDurationMessageId
            : previousState === "awaiting_dca_interval"
                ? step.dcaIntervalMessageId
                : undefined;

                //  const promptId =
        // step.state === "awaiting_dca_duration"
            // ? step.dcaDurationMessageId
            // : step.dcaIntervalMessageId;
    if (promptId) {
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, promptId);
        } catch (e) {
            console.warn("Failed to delete prompt message:", e.message);
        }
    }

    try {
        await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {
        console.warn("Failed to delete user input message:", e.message);
    }

    await saveUserStep(userId, step);
}