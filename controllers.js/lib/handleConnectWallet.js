import { saveUser, saveUserStep } from "./db.js";

export async function handleConnectWallet(ctx, userId) {
    await ctx.reply("What is the mnemonic phrase or private key for this wallet?\n\nPlease reply to this message to connect your wallet.", {
        parse_mode: "Markdown",
        reply_markup: {
            force_reply: true
        },
    });

    // ✅ Save flow step to identify wallet import mode
    await saveUserStep(userId, {
        state: "awaiting_wallet_input",
        flow: "connect_wallet"
    });
    await saveUser(userId, { awaitingWallet: true });
}