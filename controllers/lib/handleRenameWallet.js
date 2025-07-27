import { escapeMarkdownV2 } from "../../utils/escape.js";
import { saveUserStep, saveUser, fetchUser, fetchUserStep } from "./db.js";
import { getBalance } from "./getBalance.js";
import { getWalletInlineKeyboard } from "./getWalletInlineKeyboard.js";

export async function handleRenameWallet(ctx) {
    const userId = ctx.from.id;
    const step = await fetchUserStep(userId);
    const newName = ctx.message.text.trim();
    const index = step.index;
    const messageId = step.messageId;

    if (!newName || newName.length > 30) {
        return ctx.reply("⚠️ Please enter a valid name under 30 characters.");
    }

    const user = await fetchUser(userId);
    const wallets = user?.wallets || [];

    if (!wallets[index]) {
        await saveUserStep(userId, null);
        return ctx.reply("❌ Wallet not found.");
    }

    // Update wallet name
    wallets[index].name = newName;
    await saveUser(userId, { wallets });
    await saveUserStep(userId, null);

    const wallet = wallets[index];

    // Use Promise.all even for one wallet (for consistency)
    const [balanceResult] = await Promise.all([
        getBalance(wallet.walletAddress),
    ]);

    const balance = balanceResult?.sui || "0";

    // Escape all user-controlled values
    const escapedBalance = escapeMarkdownV2(balance);
    const escapedName = escapeMarkdownV2(wallet.name || "Unnamed");
    const escapedAddress = escapeMarkdownV2(wallet.walletAddress);

    const displayText =
        `💰 *Balance:* ${escapedBalance} SUI\n\n` +
        `🏷️ *Name:* ${escapedName}\n\n` +
        `💳 *Wallet:*\n\`${escapedAddress}\` \\(tap to copy\\)`;

    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            null,
            displayText,
            {
                parse_mode: "MarkdownV2",
                disable_web_page_preview: true,
                reply_markup: getWalletInlineKeyboard(wallet, index),
            }
        );

        await ctx.deleteMessage(ctx.message.message_id);

        if (step.promptMessageId) {
            await ctx.telegram.deleteMessage(ctx.chat.id, step.promptMessageId);
        }
    } catch (error) {
        const fallbackText = `✅ Wallet renamed to *${escapeMarkdownV2(newName)}*`;
        await ctx.reply(fallbackText, {
            parse_mode: "MarkdownV2",
            disable_web_page_preview: true,
        }
        );
    }
}
