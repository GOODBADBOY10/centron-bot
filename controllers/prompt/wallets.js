import { addWalletToUser, saveUserStep } from "../lib/db.js";
import { encryptWallet } from "../lib/generateWallet.js";
import { generateNewWallet } from "../lib/genNewWallet.js";


export async function promptNewWalletsCount(ctx) {
    const userId = ctx.from.id;

    await saveUserStep(userId, {
        state: "awaiting_wallet_generation_count",
        flow: "generate_wallets",
    });

    await ctx.reply("How many wallets would you like to generate? (Maximum 10)", {
        reply_markup: {
            force_reply: true,
        },
    });
}

export async function createNewWallet(ctx) {
    try {
        const userId = ctx.from.id;
        const wallet = await generateNewWallet(userId);
        const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

        const rawPrivateKey = wallet.privateKey;
        const encryptedPrivateKey = encryptWallet(wallet.privateKey, ENCRYPTION_SECRET);
        const encryptedSeedPhrase = encryptWallet(wallet.seedPhrase, ENCRYPTION_SECRET);

        const { walletAddress } = wallet;
        const newWallet = {
            walletAddress,
            privateKey: encryptedPrivateKey,
            seedPhrase: encryptedSeedPhrase,
            balance: "0.0",
        };

        await addWalletToUser(userId.toString(), newWallet);

        await ctx.answerCbQuery("✅ Wallet created!");

        let message = '';
        message += `✅ New wallet created!\n\n`;
        message += `Address: <code>${walletAddress}</code> (tap to copy)\n\n`;
        message += `Private key: <code>${rawPrivateKey}</code> (tap to copy)\n\n`;
        message += "⚠ Save your private key on paper only. Avoid storing it digitally. After you finish saving/importing the wallet credentials, delete this message. The bot will not display this information again.";

        // Clear sensitive data from memory
        wallet.privateKey = undefined;
        wallet.seedPhrase = undefined;

        return ctx.editMessageText(message, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[
                    { text: "← Back to Wallets", callback_data: "wallets" }
                ]]
            }
        });
    } catch (error) {
        console.error("Error creating new wallet:", error);
        await ctx.answerCbQuery("❌ Failed to create wallet. Please try again.", { show_alert: true });
    }
}