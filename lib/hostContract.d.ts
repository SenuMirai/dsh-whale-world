declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dsh-world-history': {
            kind: 'dsh-world-history';
            form: 'recall';
        };
        'dsh-world-summary-input': {
            kind: 'dsh-world-summary-input';
        };
        'dsh-world-life': {
            kind: 'dsh-world-life';
        };
        'dsh-world-channel-context': {
            kind: 'dsh-world-channel-context';
            form: 'recall';
        };
    }
}
export {};
