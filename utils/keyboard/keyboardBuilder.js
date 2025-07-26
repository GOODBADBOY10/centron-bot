export function buildTokenInlineRows(positions, selectedTokenAddress, index) {
    const tokenRows = [];
    // re-filter SUI again in case
    const filteredPositions = positions.filter(p => p.symbol !== "SUI");

    for (let i = 0; i < filteredPositions.length; i += 3) {
        const row = filteredPositions.slice(i, i + 3).map((pos, j) => {
            const tokenKey = `token_${i + j}`;
            const tokenAddr = pos.tokenAddress || pos.coinType;
            const isSelected = selectedTokenAddress === tokenAddr;

            return {
                text: `${isSelected ? "✅ " : ""}$${pos.symbol}`,
                callback_data: `select_token_idx_${index}_${tokenKey}`,
            }
        });

        tokenRows.push(row);
    }

    return tokenRows;
}


export function buildActionRows(mode, index) {
    const toggleButtonRow = [
        [
            { text: "Buy ↔️ Sell", callback_data: `toggle_buy_sell_idx_${index}` }
        ]
    ];

    if (mode === "buy") {
        return [
            ...toggleButtonRow,
            [
                { text: "Buy 1 SUI", callback_data: `buy_amount_1_idx_${index}` },
                { text: "Buy 5 SUI", callback_data: `buy_amount_5_idx_${index}` },
            ],
            [
                { text: "Buy Custom SUI", callback_data: `buy_custom_idx_${index}` },
                { text: "🃏 PnL Card 🃏", callback_data: `view_pnl_card_idx_${index}` },
            ],
        ];
    } else {
        return [
            ...toggleButtonRow,
            [
                { text: "Sell 50%", callback_data: `sell_amount_1_idx_${index}` },
                { text: "Sell 100%", callback_data: `sell_amount_100_idx_${index}` },
            ],
            [
                { text: "Sell X%", callback_data: `sell_custom_idx_${index}` },
                { text: "🃏 PnL Card 🃏", callback_data: `view_pnl_card_idx_${index}` },
            ],
        ];
    }
}


export function buildFooterRows(index) {
    return [
        [
            { text: "← Main Menu", callback_data: "back_to_menu" },
            { text: "🔄 Refresh", callback_data: `refresh_position_idx_${index}` },
        ],
    ];
}