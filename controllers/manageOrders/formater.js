export function formatSui(amount) {
    if (!amount) return "?";
    return (Number(amount) / 1e9).toFixed(2); // 3 decimals, e.g. 0.100
}

export function formatDuration(minutes) {
    if (minutes === "?" || !minutes) return "?";

    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = Math.floor(minutes % 60);
    const secs = Math.round((minutes % 1) * 60); // fractional minutes to seconds

    let result = [];
    if (days > 0) result.push(`${days} day${days > 1 ? "s" : ""}`);
    if (hours > 0) result.push(`${hours} hour${hours > 1 ? "s" : ""}`);
    if (mins > 0) result.push(`${mins} min${mins > 1 ? "s" : ""}`);
    if (secs > 0) result.push(`${secs} sec${secs > 1 ? "s" : ""}`);

    return result.join(" ");
}