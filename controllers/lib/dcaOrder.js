import { getUser, saveUserStep, fetchUserStep } from "./db.js";
import { buildDcaKeyboard } from "./handleLimitKeyboard.js";
import { shortAddress } from "./shortAddress.js";

export const handleDcaOrder = async (ctx) => {
    try {
        const userId = ctx.from.id;

        const step = await fetchUserStep(userId);
        if (!step) return ctx.answerCbQuery("❌ Session expired. Please start again.");

        const user = await getUser(userId);
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

        if (!wallets.length) {
            return ctx.reply("❌ No wallets found. Please import or generate one before using limit orders.");
        }

        const walletMap = wallets.reduce((map, w, i) => {
            const key = `w${i}`;
            map[key] = { ...w, address: w.address, key };
            return map;
        }, {});

        step.wallets = wallets;
        step.walletMap = walletMap;

        if (!step.selectedWallets || step.selectedWallets.length === 0) {
            step.selectedWallets = ["w0"];
        }

        const selectedWallets = step.selectedWallets;
        const mode = step.mode;
        const tokenInfo = step.tokenInfo;

        if (!tokenInfo?.symbol) {
            return ctx.answerCbQuery("❌ Token info not found. Start from Buy Token screen.");
        }

        let text = `To place a DCA order for <b>${tokenInfo.symbol}</b>, follow these steps:\n\n`;
        text += `1️⃣ Select the wallets you want to set the order for.\n`;
        text += `2️⃣ Choose a mode — Buy or Sell.\n`;
        text += `3️⃣ Enter the total duration for the DCA strategy.\n`;
        text += `4️⃣ Define the interval between each buy/sell action.\n`;
        text += `5️⃣ Use one of the buttons to determine the total amount of tokens to buy/sell.\n\n`;

        text += `<b>Selected Wallets:</b>\n`;
        selectedWallets.forEach(key => {
            const wallet = walletMap[key];
            const explorerWalletLink = `https://suiexplorer.com/address/${wallet.address || wallet.walletAddress}?network=mainnet`;
            const displayName = wallet?.name || `Wallet ${key.replace("w", "")}`;
            text += `💳 <a href="${explorerWalletLink}">${displayName}</a>\n\n`;
        });

        text += `📘 <a href="https://example.com/how-to-use">How to Use?</a>`;

        const keyboard = {
            inline_keyboard: buildDcaKeyboard(
                selectedWallets,
                wallets,
                step.showAllWallets ?? false,
                mode,
                {
                    duration: step.dcaDuration,
                    interval: step.dcaInterval
                }
            )
        };

        step.currentFlow = "dca";
        step.isInDcaFlow = true;
        step.orderMode = "dca";
        step.mode = step.mode || "buy";
        step.dcaDuration = null;
        step.dcaInterval = null;

        await saveUserStep(userId, step);

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
        } catch (e) {
            console.error("Edit failed, sending new message instead:", e);
            const sent = await ctx.reply(text, {
                parse_mode: "HTML",
                reply_markup: keyboard,
            });
            step.mainMessageId = sent.message_id;
            await saveUserStep(userId, step);
        }

        return;
    } catch (err) {
        console.error("DCA order flow failed:", err);
        return ctx.reply("❌ Something went wrong while starting DCA order setup.");
    }
};

export async function renderDcaMessage(ctx, userId, step) {
    if (!step) step = await fetchUserStep(userId);
    if (!step || !step.tokenInfo) return;

    const { selectedWallets = [], wallets = [], tokenInfo, walletMap = {}, mode = "buy" } = step;

    if (!tokenInfo?.symbol) {
        return ctx.answerCbQuery("❌ Token info not found. Start from Buy Token screen.");
    }
    let text = `To place a DCA order for <b>${tokenInfo.symbol}</b>, follow these steps:\n\n`;
    text += `1️⃣ Select the wallets you want to set the order for.\n`;
    text += `2️⃣ Choose a mode — Buy or Sell.\n`;
    text += `3️⃣ Enter the total duration for the DCA strategy.\n`;
    text += `4️⃣ Define the interval between each buy/sell action.\n`;
    text += `5️⃣ Use one of the buttons to determine the total amount of tokens to buy/sell.\n\n`;

    text += `<b>Selected Wallets:</b>\n`;
    selectedWallets.forEach(key => {
        const wallet = walletMap[key];
        const explorerWalletLink = `https://suiexplorer.com/address/${wallet.address}?network=mainnet`;
        const displayName = wallet?.name || `Wallet ${key.replace("w", "")}`;
        text += `💳 <a href="${explorerWalletLink}">${displayName}</a>\n`;
    });
    text += `\n📘 <a href="https://example.com/how-to-use">How to Use?</a>`;
    const keyboard = {
        inline_keyboard: buildDcaKeyboard(
            selectedWallets,
            wallets,
            step.showAllWallets ?? false,
            mode,
            {
                duration: step.dcaDuration,
                interval: step.dcaInterval,
            }
        )
    };

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
    } catch (e) {
        console.error("Edit failed, sending new DCA message instead:", e);
        const sent = await ctx.reply(text, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: keyboard,
        });
        step.mainMessageId = sent.message_id;
        await saveUserStep(userId, step);
    }
}

export const handleDcaSetDuration = async (ctx) => {
    const userId = ctx.from.id;
    const step = await fetchUserStep(userId);

    if (!step) {
        return ctx.answerCbQuery("❌ Session expired.");
    }

    let text = `How long would you like your DCA duration to be?\n\n`;
    text += `Use the format: "1d" for days, "1h" for hours, and "1m" for minutes (e.g. 1d 12h 30m).\n\n`;
    text += `⚠ The bot will execute an order at every set interval until the full duration is complete.`;

    const msg = await ctx.reply(text.trim(), {
        reply_markup: { force_reply: true },
    });

    step.state = "awaiting_dca_duration";
    step.dcaDurationMessageId = msg.message_id;
    await saveUserStep(userId, step);
};

export const handleDcaSetInterval = async (ctx) => {
    const userId = ctx.from.id;
    const step = await fetchUserStep(userId);

    if (!step) {
        return ctx.answerCbQuery("❌ Session expired.");
    }

    let text = `How often should the bot place your DCA orders?\n\n`;
    text += `Use the format: "1d" for days, "1h" for hours and "1m" for minutes (e.g. 1d 12h 30m).\n\n`;
    text += `⚠ An order will be executed automatically at each interval you set.`;

    const msg = await ctx.reply(text.trim(), {
        reply_markup: { force_reply: true },
    });

    step.state = "awaiting_dca_interval";
    step.dcaIntervalMessageId = msg.message_id;
    await saveUserStep(userId, step);
};

export async function showDcaConfirmation(ctx, userId, step, { mode, suiAmount }) {
    const { dcaDuration, dcaInterval, tokenInfo, selectedWallets, walletMap } = step;

    const wallets = selectedWallets.map(k => walletMap[k]);
    const walletList = wallets.map(
        w => `💳 ${w.name || w.address.slice(0, 6) + "..." + w.address.slice(-4)}`
    ).join("\n");

    const action = mode.toUpperCase();
    const amountReadable = suiAmount ? suiAmount / 1e9 : step.dcaAmount; // adjust based on how you store amounts

    const text =
        `You are about to submit a DCA order with following configuration:\n\n` +
        `${action.toUpperCase()} a total of ${amountReadable} ${mode === "buy" ? "SUI" : "%"} ` +
        `worth of $${tokenInfo.symbol} through multiple payments ` +
        `with interval ${dcaInterval} for a period of ${dcaDuration}\n\n` +
        `Selected wallets: ${walletList}`;


    const keyboard = {
        inline_keyboard: [
            [
                { text: "← Back", callback_data: "nool" },
                { text: "✅ Confirm", callback_data: "confirm_dca" }
            ]
        ]
    };

    return ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}