import { saveUserStep, fetchUserStep } from "./db.js";
import { renderDcaMessage } from "./dcaOrder.js";
import { buildDcaKeyboard, buildFullKeyboard, buildLimitOrderKeyboard, renderMainMessage } from "./handleLimitKeyboard.js";
import { shortAddress } from "./shortAddress.js";


export const handleToggleWallet = async (ctx, action) => {
    const userId = ctx.from.id;
    let step = await fetchUserStep(userId);
    if (!step) step = {};

    const walletKey = action.split(":")[1];
    let selected = new Set(
        (step.selectedWallets || []).filter(k => typeof k === "string" && k.startsWith("w"))
    );

    if (selected.has(walletKey)) {
        selected.delete(walletKey);
    } else {
        selected.add(walletKey);
    }

    step.selectedWallets = Array.from(selected);

    const walletObj = step.walletMap?.[walletKey];
    if (walletObj?.address) {
        step.currentWallet = walletObj.address;
    }

    await saveUserStep(userId, step);
    await ctx.answerCbQuery("✅ Updated selection");

    if (step.currentFlow === "limit") {
        const tokenInfo = step.tokenInfo;
        const selectedWallets = step.selectedWallets || [];
        let text = `To place a limit order for <b>${tokenInfo.symbol}</b>, follow these steps:\n\n`;
        text += `1️⃣ Select the wallets you want to set the order for.\n`;
        text += `2️⃣ Choose a mode — Buy (Take-Profit) or Sell (Stop-Loss).\n`;
        text += `3️⃣ Enter the target market cap or price to trigger the order.\n`;
        text += `4️⃣ Tap one of the buttons to define your order size.\n\n`;

        text += `<b>Selected Wallets:</b>\n`;
        selectedWallets.forEach(key => {
            const wallet = step.walletMap?.[key];
            const explorerWalletLink = `https://suiexplorer.com/address/${wallet.address || wallet.walletAddress}?network=mainnet`;
            const name = wallet?.name || shortAddress(wallet?.address || key);
            text += `💳 <a href="${explorerWalletLink}">${name}</a>\n`;
        });

        text += `\n📘 <a href="https://example.com/how-to-use">How to Use?</a>`;

        const keyboard = buildLimitOrderKeyboard(
            selectedWallets,
            step.wallets,
            step.mode || "buy",
            step.limitTriggerValue,
            step.showAllWallets
        );
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                step.mainMessageId,
                undefined,
                text,
                {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: { inline_keyboard: keyboard },
                }
            );
        } catch (err) {
            console.error("Failed to update limit message:", err.message);
        }
    } else if (step.currentFlow === "dca") {
        // DCA UI refresh
        await renderDcaMessage(ctx, userId, step);
    } else {
        await renderMainMessage(ctx, userId);
    }
    return;
};

export const handleToggleMode = async (ctx) => {
    const userId = ctx.from.id;
    let step = await fetchUserStep(userId);
    if (!step) step = {};

    if (!step.mode) step.mode = "buy";
    step.mode = step.mode === "buy" ? "sell" : "buy";

    let keyboard;

    if (step.currentFlow === "limit") {
        const allWallets = Object.values(step.walletMap || {}).filter(
            (w) => w && typeof w.walletAddress === "string"
        );
        const selectedWallets = (step.selectedWallets || [])
            .map((w) => typeof w === "string" ? w : w?.address || w?.walletAddress)
            .filter(Boolean);

        keyboard = buildLimitOrderKeyboard(
            selectedWallets,
            allWallets,
            step.mode,
            step.limitTriggerValue,
            step.showAllWallets
        );
    } else if (step.currentFlow === "dca") {
        keyboard = buildDcaKeyboard(
            step.selectedWallets || [],
            step.wallets || [],
            step.showAllWallets ?? false,
            step.mode,
            {
                duration: step.dcaDuration,
                interval: step.dcaInterval
            }
        );
    } else {
        keyboard = buildFullKeyboard(
            step.selectedWallets || [],
            step.wallets || [],
            step.showAllWallets ?? false,
            step.mode
        );
    }

    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
        await saveUserStep(userId, step);
    } catch (err) {
        console.error("Failed to update keyboard:", err.message);
    }

    return ctx.answerCbQuery(`✅ Switched to ${step.mode.toUpperCase()} mode`);
};

export const handleToggleAllWallets = async (ctx) => {
    const userId = ctx.from.id;
    let step = await fetchUserStep(userId);
    if (!step) step = {};

    step.showAllWallets = !step.showAllWallets;

    const flow = step.currentFlow;
    const allWallets = flow === "limit"
        ? Object.values(step.walletMap || {}).filter(w => typeof w.walletAddress === "string")
        : step.wallets || [];

    const keyboard = flow === "limit"
        ? buildLimitOrderKeyboard(
            step.selectedWallets || [],
            allWallets,
            step.mode || "buy",
            step.limitTriggerValue,
            step.showAllWallets
        )
        : flow === "dca"
            ? buildDcaKeyboard(
                step.selectedWallets || [],
                allWallets,
                step.showAllWallets,
                step.mode || "buy"
            )
            : buildFullKeyboard(
                step.selectedWallets || [],
                allWallets,
                step.showAllWallets,
                step.mode || "buy"
            );

    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
        await saveUserStep(userId, step);
    } catch (error) {
        console.error("Failed to update wallet toggle keyboard:", error.message);
    }

    return ctx.answerCbQuery("✅ Wallet view updated");
};