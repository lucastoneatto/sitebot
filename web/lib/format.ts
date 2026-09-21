/** Costs in dollars with 4 decimals: per-message amounts are fractions of a cent. */
export const money = (value: number) => `$${value.toFixed(4)}`;
