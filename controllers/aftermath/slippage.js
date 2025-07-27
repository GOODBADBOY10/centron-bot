export function normalizeSlippage(slippage) {
    return slippage >= 1 ? slippage / 100 : slippage;
}
