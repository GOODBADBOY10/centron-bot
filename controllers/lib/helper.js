export function formatDurationPretty(minutes) {
    if (!minutes) return "-";
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;

    let parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);

    return parts.join(" ") || `${minutes}m`;
}
