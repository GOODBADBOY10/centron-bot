export function toSmallestUnit(amountFloat, decimals = 9) {
  const factor = 10 ** decimals;
  return (amountFloat * factor).toFixed(0);
}