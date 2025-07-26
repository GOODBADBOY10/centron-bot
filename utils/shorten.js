export function shorten(address, start = 6, end = 4) {
    if (!address || typeof address !== "string") return "Invalid Address";
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  }