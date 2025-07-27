import { saveUser, addWalletToUser, saveUserStep } from "./db.js";
import { encryptWallet } from "./generateWallet.js";
import { handleWallets } from "./handleWallets.js";
import { importWalletFromInput } from "./importWallet.js";

export async function handleWalletImport(ctx, userId) {
    try {
        const userInput = ctx.message?.text?.trim();
        if (!userInput) {
            return ctx.reply("❌ Input is empty. Please paste a valid *mnemonic* or *private key*.", {
                parse_mode: "Markdown"
            });
        }
        const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

        const imported = await importWalletFromInput(userInput);

        const encryptedPrivateKey = encryptWallet(imported.privateKey, ENCRYPTION_SECRET);
        const encryptedSeedPhrase = imported.phrase
            ? encryptWallet(imported.phrase, ENCRYPTION_SECRET)
            : null;

        const walletToSave = {
            address: imported.address,
            privateKey: encryptedPrivateKey,
            ...(encryptedSeedPhrase ? { seedPhrase: encryptedSeedPhrase } : {}),
        };

        await addWalletToUser(userId.toString(), walletToSave);
        await saveUser(userId, { awaitingWallet: false });
        await saveUserStep(userId, null);

        await ctx.reply(
            `✅ Wallet connected!\n\nAddress: \`${imported.address}\` (tap to copy)\n\nType: ${imported.type}`,
            { parse_mode: "Markdown" }
        );

        return await handleWallets(ctx, userId);
    } catch (err) {
        let errorMessage = "❌ Failed to import wallet. Please ensure you're using a valid:\n";
        errorMessage += "- 12 or 24 word *mnemonic phrase* (space-separated), or\n";
        errorMessage += "- 64-character *private key* (hex or base64).";
        return ctx.reply(errorMessage, { parse_mode: "Markdown" });
    }
}