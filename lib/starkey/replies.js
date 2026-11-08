/**
 * 等她的回复（2026-11-03 夜加）
 *
 * 桌宠那条链路是「一问一答」：网关把话送进家，然后得拿着她的答复回去。
 * 桥本身只负责「送进去」和「推给 outlets」，不提供等待，所以这里补一个等待队列。
 *
 * 口径跟桥一致：**她在被送进去之后说的第一段可见正文，就是这一问的答复。**
 * 不是「最后一轮的所有话」，也不是「所有 assistant 消息拼起来」——一次只认第一段，
 * 因为桌宠只等一句，把它等到的话原样说出来才诚实。
 */
export function createReplyWaiter(deps = {}) {
  const timeoutMs = deps.timeoutMs ?? 120_000;
  /** 队列：{ ticket, resolve, reject, timer, at } */
  const waiting = [];

  function clear(entry) {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    const i = waiting.indexOf(entry);
    if (i >= 0) waiting.splice(i, 1);
  }

  return {
    /** 挂一个等待；超时用 STAR_KEY_TIMEOUT 拒绝，好让网关区分「她没说话」和「出错了」。 */
    wait(ticket, overrideMs) {
      return new Promise((resolve, reject) => {
        const entry = { ticket, resolve, reject, at: Date.now() };
        entry.timer = setTimeout(() => {
          clear(entry);
          const error = new Error('等她回话超时');
          error.code = 'STAR_KEY_TIMEOUT';
          reject(error);
        }, overrideMs ?? timeoutMs);
        entry.timer.unref?.();
        waiting.push(entry);
      });
    },
    /**
     * 收到一段她的正文。有等待就交给最早那个；没等待就丢掉（她自己说的话，
     * 不是谁问来的，不该被这条通道吃掉——家会话的写入通道照常记）。
     */
    note(text) {
      const body = String(text ?? '').trim();
      if (body === '') return false;
      const entry = waiting.shift();
      if (!entry) return false;
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.resolve(body);
      return true;
    },
    size: () => waiting.length,
    /** 网关停了就把所有等待放掉，别让桌宠干等。 */
    close() {
      for (const entry of waiting.splice(0)) {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        const error = new Error('网关已停止');
        error.code = 'STAR_KEY_STOPPED';
        entry.reject(error);
      }
    },
  };
}
