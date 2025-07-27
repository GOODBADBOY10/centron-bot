import { getUser, fetchUserStep, saveUserStep } from "./db.js";
import { buildLimitOrderKeyboard } from "./handleLimitKeyboard.js";
import { shortAddress } from "./shortAddress.js";

export const handleLimitOrder = async (ctx) => {
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

        step.currentFlow = "limit";
        step.isInLimitFlow = true;
        step.mode = step.mode || "buy";
        step.orderMode = "limit";
        step.limitTriggerValue = null;

        const selectedWallets = step.selectedWallets;
        const mode = step.mode;
        const tokenInfo = step.tokenInfo;

        if (!tokenInfo?.symbol) {
            return ctx.answerCbQuery("❌ Token info not found. Start from Buy Token screen.");
        }

        let text = `To place a limit order for <b>${tokenInfo.symbol}</b>, follow these steps:\n\n`;
        text += `1️⃣ Select the wallets you want to set the order for.\n`;
        text += `2️⃣ Choose a mode — Buy (Take-Profit) or Sell (Stop-Loss).\n`;
        text += `3️⃣ Enter the target market cap or price to trigger the order.\n`;
        text += `4️⃣ Tap one of the buttons to define your order size.\n\n`;

        text += `<b>Selected Wallets:</b>\n`;
        selectedWallets.forEach(key => {
            const wallet = walletMap[key];
            const explorerWalletLink = `https://suiexplorer.com/address/${wallet.address || wallet.walletAddress}?network=mainnet`;
            const displayName = wallet?.name || `Wallet ${key.replace("w", "")}`;
            text += `💳 <a href="${explorerWalletLink}">${displayName}</a>\n\n`;
        });

        text += `📘 <a href="https://example.com/how-to-use">How to Use?</a>`;

        const keyboard = {
            inline_keyboard: buildLimitOrderKeyboard(
                selectedWallets,
                wallets,
                mode,
                step.limitTriggerValue
            ),
        };

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
            console.warn("Failed to edit message — possibly deleted or outdated. Sending new one.");
            const sent = await ctx.reply(text, {
                parse_mode: "HTML",
                reply_markup: keyboard,
            });
            step.mainMessageId = sent.message_id;
            await saveUserStep(userId, step);
        }
        return;
    } catch (err) {
        return ctx.reply("❌ Something went wrong while starting limit order setup.");
    }
};


export const handleEnterMcap = async (ctx) => {
    try {
        const userId = ctx.from.id;
        const step = await fetchUserStep(userId);

        if (!step) {
            return ctx.answerCbQuery("❌ Session expired. Please start again.");
        }
        // Set session state for awaiting mcap input
        step.state = "awaiting_limit_trigger_value";
        step.currentFlow = "limit";
        await saveUserStep(userId, step);

        await ctx.answerCbQuery();

        let promptText = `What market cap threshold would you like to set (minimum is $1)?\n\n`;
        promptText += `⚠ Once the token reaches this market cap, your limit order will be triggered.`;

        const prompt = await ctx.reply(promptText, {
            parse_mode: "HTML",
            reply_markup: {
                force_reply: true,
            },
        });

        step.mcapPromptMessageId = prompt.message_id;
        await saveUserStep(userId, step);

        return;
    } catch (err) {
        return ctx.reply("❌ An error occurred while setting your market cap threshold.");
    }
};