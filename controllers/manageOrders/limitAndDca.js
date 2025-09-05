import { saveUserStep } from '../lib/db.js';
import { db } from '../lib/db.js';
import { fetchUser } from '../lib/db.js';

export async function getUserOrders(userId) {
    try {
        const [limitSnap, dcaSnap] = await Promise.all([
            db.collection("limitOrders").where("userId", "==", String(userId)).get(),
            db.collection("dcaOrders").where("userId", "==", String(userId)).get(),
        ]);

        const limitOrders = limitSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const dcaOrders = dcaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // ✅ Add a message if both are empty
        if (limitOrders.length === 0 && dcaOrders.length === 0) {
            return { limitOrders, dcaOrders, message: "❌ You don’t have any limit or DCA orders yet." };
        }

        // ✅ Optional: separate messages if only one is missing
        // if (limitOrders.length === 0 && dcaOrders.length > 0) {
        //     return { limitOrders, dcaOrders, message: "⚠️ You don’t have any limit orders." };
        // }
        // if (dcaOrders.length === 0 && limitOrders.length > 0) {
        //     return { limitOrders, dcaOrders, message: "⚠️ You don’t have any DCA orders." };
        // }

        return { limitOrders, dcaOrders };
    } catch (err) {
        console.error("❌ Failed to fetch user orders:", err);
        return { limitOrders: [], dcaOrders: [], message: "❌ Failed to fetch your orders." };
    }
}

export async function checkUserOrders(userId) {
  const { limitOrders, dcaOrders } = await getUserOrders(userId);
  return {
    hasOrders: limitOrders.length > 0 || dcaOrders.length > 0,
    limitOrders,
    dcaOrders,
  };
}


export async function showWalletsForOrders(ctx, userId) {
    try {
        const user = await fetchUser(userId);
        const allWallets = user?.wallets || [];

        if (!allWallets.length) {
            return ctx.reply("❌ You haven't added any wallets yet.");
        }

        const walletButtons = [];
        const walletMap = {};

        allWallets.forEach((wallet, index) => {
            const address = wallet.address || wallet.walletAddress;
            if (!address) return; // skip invalid wallet

            const label = wallet.label || wallet.name || `${address.slice(0, 5)}...${address.slice(-4)}`;
            walletMap[`wallet_${index}`] = address;
            walletButtons.push({
                text: `💳 ${label}`,
                callback_data: `view_orders_idx_${index}`, // different prefix than positions
            });
        });

        const keyboard = [];
        for (let i = 0; i < walletButtons.length; i += 2) {
            keyboard.push(walletButtons.slice(i, i + 2));
        }
        keyboard.push([{ text: "← Main Menu", callback_data: "start" }]);

        await saveUserStep(userId, {
            state: "awaiting_order_wallet",
            walletMap,
        });

        const messageText = `Select a wallet to see a list of active Limit & DCA Orders for it:`
        await ctx.reply(messageText, {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup: { inline_keyboard: keyboard },
        });
        return true;
    } catch (e) {
        console.error(`❌ Error showing wallet list for user ${userId}:`, e?.message || e);
        return ctx.reply("⚠ Failed to load wallets.");
    }
}