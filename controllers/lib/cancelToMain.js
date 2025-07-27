import { fetchUser } from "./db.js";
import { getBalance } from "./getBalance.js";
import { mainMenu } from "./mainMenu.js";

export const handleCancelToMain = async (ctx) => {
    try {
        await ctx.deleteMessage();

        const userId = ctx.from.id;
        const user = await fetchUser(userId);
        const wallets = user?.wallets || [];

        if (!user) {
            return ctx.reply("❌ Wallet not found. Use /start to generate one.");
        }

        let message = "";
        message += "*Welcome to Centron Bot* 👋\n\n";
        message += "Trade seamlessly on Sui with low fees + high speeds.\n\n";
        message += "*Wallets:*\n";

        for (let i = 0; i < wallets.length; i++) {
            const wallet = wallets[i];
            const address = wallet.walletAddress;
            if (!address) continue;

            const balance = await getBalance(address) || { sui: "0", usd: "0" };
            const name = wallet.name?.trim();
            const label = name || `Wallet ${i + 1}`;

            // Escape special Markdown characters
            const escapedAddress = address.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
            const escapedLabel = label.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

            message += `*${escapedLabel}*: ${balance.sui} SUI ($${balance.usd}) \n`;
            message += `\`${escapedAddress}\` (tap to copy)\n\n`;
        }

        message += "To start trading, tap *Buy a Token* and paste the token address.";

        return ctx.reply(message, {
            parse_mode: "MarkdownV2",
            ...mainMenu,
        });
    } catch (err) {
        return ctx.reply("❌ An error occurred returning to the main menu.");
    }
};
