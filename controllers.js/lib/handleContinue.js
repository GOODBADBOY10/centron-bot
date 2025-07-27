import { fetchUser } from "./db.js";
import { mainMenu } from "./mainMenu.js";

export async function handleContinue(ctx) {
    const userId = ctx.from.id;
    const user = await fetchUser(userId);

    if (!user || !user.walletAddress) {
        return ctx.reply("❌ Wallet not found. Use /start to generate one.");
    }

    const welcomeMessage = `
        👋 *Welcome to Centron Bot*
    
        🚀 Trade tokens on SUI with the fastest trading bot. All DEXes + MovePump supported!
    
        💸 *Earn up to 35%* of your friends' trading fees!  
        Invite friends through our *5-level referral system* and start earning today!
    `;
    return ctx.reply(welcomeMessage, {
        parse_mode: "Markdown",
        ...mainMenu
    });
};
