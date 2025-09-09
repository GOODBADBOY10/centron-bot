import { generateNewWallet } from "./genNewWallet.js";
import { addWalletToUser, saveUserStep } from "./db.js"
import { encryptWallet } from "./generateWallet.js";

export async function handleWalletGenerationRequest(ctx, userId) {
    try {
        const count = parseInt(ctx.message.text);

        if (isNaN(count) || count < 1 || count > 10) {
            await ctx.reply("❌ Please enter a number between 1 and 10.");
            return;
        }
        await ctx.reply(`Generating ${count} wallet(s)...`);

        const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

        for (let i = 0; i < count; i++) {
            const wallet = await generateNewWallet(userId);
            const { walletAddress, privateKey, seedPhrase } = wallet;

            const encryptedPrivateKey = encryptWallet(privateKey, ENCRYPTION_SECRET);
            const encryptedSeedPhrase = seedPhrase ? encryptWallet(seedPhrase, ENCRYPTION_SECRET) : undefined;

            const newWallet = {
                walletAddress,
                privateKey: encryptedPrivateKey,
                ...(seedPhrase ? { seedPhrase: encryptedSeedPhrase } : {}),
                type: seedPhrase ? "mnemonic" : "privateKey",
                balance: "0.0"
            };

            await addWalletToUser(userId, newWallet);

            let message = '';
            message += `✅ New Wallet ${i + 1} Generated! \n\n`;
            message += `Address: <code>${walletAddress}</code> (tap to copy)\n\n`;
            message += `Private key: <code>${privateKey}</code> (tap to copy)\n\n`;
            message += "⚠ Save your private key on paper only. Avoid storing it digitally. After you finish saving/importing the wallet credentials, delete this message. The bot will not display this information again.";

            await ctx.reply(message, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "← Back to Wallets", callback_data: "wallets" }
                    ]]
                }
            });

            // Optional: Clear raw keys from memory
            wallet.privateKey = undefined;
            wallet.seedPhrase = undefined;
        }

        await saveUserStep(userId, null); // Clear the step
    } catch (error) {
        await ctx.reply("⚠️ An error occurred while generating wallets. Please try again later.");
    }
}