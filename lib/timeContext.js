/** ISO 8601 local time with its UTC offset in the given IANA zone, e.g. 2026-10-23T21:30:00+09:00. */
export function formatLocalTime(now, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.slice(3);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
export function formatTimeContext(now, timeZone) {
    return `当前时间：${formatLocalTime(now, timeZone)}\n时区：${timeZone}`;
}
