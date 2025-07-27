export function shortAddress(address) {
    if (typeof address !== "string") {
        return "InvalidAddr";
    }

    if (address.length < 10) {
        return address;
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}