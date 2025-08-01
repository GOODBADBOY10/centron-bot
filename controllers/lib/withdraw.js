import { fetchUser, saveUserStep, fetchUserStep } from "./db.js";
import { createWithdrawWalletKeyboard, sendSui } from "./withdrawSui.js";
import { decryptWallet } from "./generateWallet.js";

export const handleWithdrawSui = async (ctx, action) => {
    const index = Number(action.split("_").pop());
    const userId = ctx.from.id.toString();
    const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

    const user = await fetchUser(userId);
    const selectedWallet = user.wallets?.[index];

    if (!selectedWallet) {
        await ctx.answerCbQuery("❌ Wallet not found.", { show_alert: true });
        return;
    }

    const step = {
        action: "awaiting_withdraw_sui_address",
        selectedWalletIndex: index,
        walletAddress: selectedWallet.walletAddress,
        tokenType: "SUI",
    };

    try {
        const encrypted = selectedWallet.seedPhrase || selectedWallet.privateKey;
        const decrypted = decryptWallet(encrypted, ENCRYPTION_SECRET);
        let phraseOrKey;
        if (typeof decrypted === "string") {
            phraseOrKey = decrypted;
        } else if (decrypted && typeof decrypted === "object") {
            phraseOrKey = decrypted.privateKey || decrypted.seedPhrase;
        }

        if (!phraseOrKey) {
            await ctx.answerCbQuery("❌ Failed to decrypt wallet.", { show_alert: true });
            return;
        }

        if (selectedWallet.seedPhrase) {
            step.seedPhrase = phraseOrKey;
        } else {
            step.privateKey = phraseOrKey;
        }
    } catch (err) {
        await ctx.answerCbQuery("❌ Failed to decrypt wallet.", { show_alert: true });
        return;
    }

    await saveUserStep(userId, step);

    await ctx.answerCbQuery("✅ Wallet selected");

    // Update keyboard
    await ctx.editMessageReplyMarkup(createWithdrawWalletKeyboard(userId));

    // Prompt user for address
    const displayText = `Please enter the withdrawal address below.\n\n` +
        `Note: To send SUI to multiple wallets simultaneously, enter the addresses as a comma-separated list (e.g., wallet1,wallet2,wallet3)`;

    await ctx.reply(displayText, {
        parse_mode: "HTML",
        reply_markup: { force_reply: true },
    });
};


export const handleConfirmWithdraw = async (ctx) => {
    const userId = ctx.from.id;
    const step = await fetchUserStep(userId);

    if (
        !step?.withdrawAddress ||
        !step?.amount ||
        !step?.walletAddress ||
        (!step?.seedPhrase && !step?.privateKey)
    ) {
        return ctx.answerCbQuery("❌ Missing withdrawal data", { show_alert: true });
    }

    await ctx.editMessageText("⏳Sending SUI...Please wait.");
    const key = step.seedPhrase || step.privateKey;
    try {
        const txDigest = await sendSui(key, step.withdrawAddress, step.amount);
        if (!txDigest) {
            await ctx.editMessageText("❌ Failed to send SUI. No coins or unknown error.");
        } else {
            await ctx.editMessageText(
                `✅ SUI Sent Successfully!\n\n` +
                `🔗 [View Transaction Record on Explorer](https://suivision.xyz/txblock/${txDigest}?network=mainnet)`,
                {
                    parse_mode: "Markdown",
                    disable_web_page_preview: true,
                }
            );
        }
    } catch (err) {
        await ctx.editMessageText("❌ Failed to send SUI. Please try again later.");
    }
    await saveUserStep(userId, null);
};