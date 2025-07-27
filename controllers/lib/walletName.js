import { fetchUser, saveUser, saveUserStep } from "./db.js";
import { getBalance } from "./getBalance.js";
import { getWalletInlineKeyboard } from "./getWalletInlineKeyboard.js";

export const handleWalletInfo = async (ctx, action) => {
    const userId = ctx.from.id;
    const index = parseInt(action.split("_")[1]);

    const user = await fetchUser(userId);
    const wallet = user.wallets?.[index];

    if (!wallet || !wallet.walletAddress) {
        return ctx.answerCbQuery("Wallet not found.", { show_alert: true });
    }

    let balance;
    try {
        balance = await getBalance(wallet.walletAddress);
    } catch (error) {
        return ctx.answerCbQuery("Failed to fetch wallet balance.", { show_alert: true });
    }

    const balanceDisplay = typeof balance === "object" ? balance.sui : balance;

    await ctx.editMessageText(
        `💰 Balance: ${balanceDisplay} SUI\n\n` +
        `🏷️ Name: ${wallet.name || "Unnamed"}\n\n` +
        `💳 Wallet:\n\`${wallet.walletAddress}\` (tap to copy)`,
        {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            reply_markup: getWalletInlineKeyboard(wallet, index),
        }
    );
};

export const handleDeleteWalletPrompt = async (ctx, action) => {
    const userId = ctx.from.id;
    const index = parseInt(action.split("_")[2]);

    const user = await fetchUser(userId);
    const wallet = user.wallets?.[index];

    if (!wallet || !wallet.walletAddress) {
        return ctx.answerCbQuery("Wallet not found.", { show_alert: true });
    }

    await ctx.editMessageText(
        `⚠ Deleting Wallet\n\n\`${wallet.walletAddress}\`\n\nMake sure you've saved your private key. This action is irreversible.`,
        {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "✅ Confirm",
                            callback_data: `confirm_delete_wallet_${index}`,
                        },
                        {
                            text: "❌ Cancel",
                            callback_data: `wallet_${index}`,
                        },
                    ],
                ],
            },
        }
    );
};

export const handleConfirmDeleteWallet = async (ctx, action) => {
    const userId = ctx.from.id;
    const index = parseInt(action.split("_")[3]);

    const user = await fetchUser(userId);
    const wallets = user.wallets || [];

    // Remove the wallet at the given index
    const updatedWallets = wallets.filter((_, i) => i !== index);

    await saveUser(userId, {
        wallets: updatedWallets,
    });

    await ctx.editMessageText("✅ Wallet deleted.", {
        reply_markup: {
            inline_keyboard: [[{ text: "← Back", callback_data: "wallets" }]],
        },
    });
};

export const handleRenameWalletPrompt = async (ctx, action) => {
    const userId = ctx.from.id;
    const index = parseInt(action.split("_")[2]);

    const user = await fetchUser(userId);
    const wallet = user.wallets?.[index];

    if (!wallet || !wallet.walletAddress) {
        return ctx.answerCbQuery("Wallet not found.", { show_alert: true });
    }

    await ctx.answerCbQuery();

    const fullAddress = wallet.walletAddress;
    const short = `${fullAddress.slice(0, 6)}...${fullAddress.slice(-4)}`;
    const url = `https://suivision.xyz/account/${fullAddress}`;

    const promptMessage = await ctx.reply(
        `📝 Set a new name for wallet <a href="${url}">${short}</a> (must be 1–8 characters long and contain only letters and numbers).`,
        {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                force_reply: true,
            },
        }
    );

    await saveUserStep(userId, {
        action: "renaming_wallet",
        index,
        messageId: ctx.callbackQuery.message.message_id,
        promptMessageId: promptMessage.message_id,
    });
};