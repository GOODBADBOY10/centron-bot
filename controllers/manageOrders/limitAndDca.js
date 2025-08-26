// fetch order
async function getUserOrders(userId) {
    const user = await fetchUser(userId);
    if (!user) {
        console.log(`❌ No user found for ID: ${userId}`);
        return { limitOrders: [], dcaOrders: [] };
    }

    const limitOrders = user.limitOrders || [];
    const dcaOrders = user.dcaOrders || [];

    console.log(`- Limit Orders (${limitOrders.length}):`, limitOrders);
    console.log(`- DCA Orders (${dcaOrders.length}):`, dcaOrders);

    return { limitOrders, dcaOrders };
}


async function getUserOrders(userId) {
    const user = await fetchUser(userId);
    if (!user) return { limitOrders: [], dcaOrders: [] };

    return {
        limitOrders: user.limitOrders || [],
        dcaOrders: user.dcaOrders || []
    };
}


// format order
function formatLimitOrder(order, index, walletName, tokenSymbol) {
    const amount =
        order.suiAmount != null
            ? `${order.suiAmount} SUI`
            : `${order.suiPercentage}%`;

    return (
        `${index + 1}. ${order.mode.toUpperCase()} ${amount} of ${tokenSymbol}\n` +
        `   Wallet: ${walletName}\n` +
        `   Trigger: $${formatMarketCapValue(order.triggerValue)}\n` +
        `   Slippage: ${order.slippage}%\n`
    );
}

function formatDCAOrder(order, index, walletName, tokenSymbol) {
    return (
        `${index + 1}. ${order.mode.toUpperCase()} ${order.suiAmount} SUI of ${tokenSymbol}\n` +
        `   Wallet: ${walletName}\n` +
        `   Every: ${order.intervalHours}h\n` +
        `   Slippage: ${order.slippage}%\n`
    );
}


// show menu
export const handleManageOrders = async (ctx) => {
    const userId = ctx.from.id.toString();
    const { limitOrders, dcaOrders } = await getUserOrders(userId);

    let text = "📋 <b>Your Orders</b>\n\n";

    if (limitOrders.length === 0 && dcaOrders.length === 0) {
        text += "❌ You have no active Limit or DCA orders.";
        return ctx.reply(text, { parse_mode: "HTML" });
    }

    if (limitOrders.length > 0) {
        text += "<b>Limit Orders:</b>\n";
        limitOrders.forEach((o, i) => {
            text += formatLimitOrder(o, i, o.walletName || "Unnamed", o.tokenSymbol || "Unknown") + "\n";
        });
    }

    if (dcaOrders.length > 0) {
        text += "\n<b>DCA Orders:</b>\n";
        dcaOrders.forEach((o, i) => {
            text += formatDCAOrder(o, i, o.walletName || "Unnamed", o.tokenSymbol || "Unknown") + "\n";
        });
    }

    // Inline keyboard for cancellation
    const keyboard = {
        inline_keyboard: [
            ...limitOrders.map((_, i) => [{ text: `❌ Cancel Limit #${i + 1}`, callback_data: `cancel_limit_${i}` }]),
            ...dcaOrders.map((_, i) => [{ text: `❌ Cancel DCA #${i + 1}`, callback_data: `cancel_dca_${i}` }])
        ]
    };

    return ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
};


// cancel orders
export const handleCancelOrder = async (ctx, action) => {
    const userId = ctx.from.id.toString();
    const { limitOrders, dcaOrders } = await getUserOrders(userId);

    if (action.startsWith("cancel_limit_")) {
        const index = parseInt(action.replace("cancel_limit_", ""), 10);
        if (limitOrders[index]) {
            limitOrders.splice(index, 1);
            await updateUser(userId, { limitOrders });
            return ctx.editMessageText("✅ Limit order cancelled.", { parse_mode: "HTML" });
        }
    }

    if (action.startsWith("cancel_dca_")) {
        const index = parseInt(action.replace("cancel_dca_", ""), 10);
        if (dcaOrders[index]) {
            dcaOrders.splice(index, 1);
            await updateUser(userId, { dcaOrders });
            return ctx.editMessageText("✅ DCA order cancelled.", { parse_mode: "HTML" });
        }
    }
};
