import { defineTool } from '@deepseek-ai/dsh-tools';
import { exampleTime, fillMessage, readAlarmMessages } from "./messages.js";
import { pushOf } from "../ecosystem/shared/outlets.js";
export function alarmDescriptions(messages = readAlarmMessages(undefined), values = { example: exampleTime('UTC'), fallbackWakeTime: '09:00' }) {
    return { plan: fillMessage(messages, 'plan_next 说明', values), check: fillMessage(messages, 'check_alarm 说明', values), cancel: fillMessage(messages, 'cancel_alarm 说明', values) };
}
const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
export function lifeTools(host) {
    const { companion, partner } = host.names ?? { companion: 'TA', partner: '伙伴' };
    const descriptions = host.descriptions ?? alarmDescriptions();
    const planNext = defineTool({
        name: 'plan_next',
        description: descriptions.plan,
        parameters: { at: { type: 'string' }, after_minutes: { type: 'number' }, note: { type: 'string', required: true } },
        output: text,
        execute: async ({ at, after_minutes, note }) => host.planNext({ ...(at === undefined ? {} : { at }), ...(after_minutes === undefined ? {} : { after_minutes }) }, note),
    });
    const { toast, outlets } = host.notifier;
    const reaching = outlets.filter(outlet => outlet.kinds.includes('reach'));
    const channelNames = [...(toast ? ['系统通知'] : []), ...reaching.map(outlet => outlet.name)];
    const reachOut = defineTool({
        name: 'reach_out',
        description: `想找${partner}时用：先在家里正常把话说出来，再用它把这句话送到${partner}面前（${channelNames.length ? channelNames.join(' + ') : '现在还没有配置任何通道'}）。image 可选，是一个表情的名字，接收的一方认得才会显示。找${partner}时说一两句就好，细节留在家里，${partner}来了自己会看。`,
        parameters: { text: { type: 'string', required: true }, image: { type: 'string' } },
        output: text,
        execute: async ({ text: message, image }) => {
            if (!channelNames.length)
                throw new Error('现在还没有配置任何通道，话留在家里了。');
            const push = pushOf(message, 'reach', companion, host.origin?.(), image);
            const channels = [
                ...(toast ? [['系统通知', '已发出', toast.call(host.notifier, companion, message)]] : []),
                ...reaching.map(outlet => [outlet.name, '已送到', outlet.send(push)]),
            ];
            const results = await Promise.allSettled(channels.map(([, , sent]) => sent));
            const summary = `${results.map((result, index) => { const [name, done] = channels[index]; return result.status === 'fulfilled' ? `${name}${done}` : `${name}没送到：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`; }).join('；')}。`;
            if (results.every(result => result.status === 'rejected'))
                throw new Error(summary);
            return summary;
        },
    });
    /*
     * 写信（2026-11-08 从「鱼与人」搬过来）。
     *
     * 只有家才挂（见 toolRegistry 的 HOME_TOOLS）：信是在自己房间里写的，
     * 隔着一层 QQ 写不了 —— 和 reach_out / 身体那几只同一个理由。
     *
     * 说明里明写「不一定每天写、没什么想说就不写」，因为以前那套是有额度的
     * （每天最多 2 篇），额度会变成压力，压力会变成凑数的信。
     */
    const writeLetter = host.writeLetter
        ? defineTool({
            name: 'write_letter',
            description: `有话想慢慢跟${partner}说的时候用。信写在自己家里，只有${partner}在世界设置的「她写的信」那一页能看到 —— 不发到任何公开的地方，也不通知谁。不一定每天写，没什么想说就不写。`,
            parameters: { body: { type: 'string', required: true }, title: { type: 'string' } },
            output: text,
            execute: async ({ body, title }) => host.writeLetter({ body, ...(title === undefined ? {} : { title }) }),
        })
        : null;
    const { checkAlarm, cancelAlarm } = host;
    if (!checkAlarm || !cancelAlarm)
        return [planNext, reachOut, writeLetter].filter(Boolean);
    const check = defineTool({ name: 'check_alarm', description: descriptions.check, parameters: {}, output: text, execute: async () => checkAlarm.call(host) });
    const cancel = defineTool({ name: 'cancel_alarm', description: descriptions.cancel, parameters: {}, output: text, execute: async () => cancelAlarm.call(host) });
    return [planNext, reachOut, check, cancel, writeLetter].filter(Boolean);
}
