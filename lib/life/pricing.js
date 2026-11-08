const FLASH = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] };
const PRO = { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] };
/** Matched as substrings of the model id; anything else is priced as Flash. */
const PRICES = [['deepseek-v4-pro', PRO], ['deepseek-flash', FLASH], ['deepseek-v4-flash', FLASH]];
/** Beijing weekday hours priced as peak; weekends and the statutory holidays below are off-peak all day. */
const PEAK_HOURS = [[9, 12], [14, 18]];
/** Days off by the State Council's 2026 schedule; the working weekends are off-peak as weekends anyway. Add each new year's. */
const HOLIDAYS = new Set([
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]);
export function isPeak(at) {
    const beijing = new Date(at.getTime() + 8 * 3_600_000);
    const day = beijing.getUTCDay();
    if (day === 0 || day === 6 || HOLIDAYS.has(beijing.toISOString().slice(0, 10)))
        return false;
    const hour = beijing.getUTCHours();
    return PEAK_HOURS.some(([from, to]) => hour >= from && hour < to);
}
/** What one model step cost in CNY. DeepSeek reports cache hits apart from the other input; reasoning is part of the output. */
export function stepCost(usage, model, at) {
    const price = PRICES.find(([id]) => model.toLowerCase().includes(id))?.[1] ?? FLASH;
    const peak = isPeak(at) ? 1 : 0;
    return ((usage.cacheReadTokens ?? 0) * price.hit[peak] + usage.inputTokens * price.miss[peak] + usage.outputTokens * price.out[peak]) / 1e6;
}
