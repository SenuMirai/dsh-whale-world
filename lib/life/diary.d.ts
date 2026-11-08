export declare function createDiaryReader(diaryDir: string): {
    dates: () => string[];
    read: (date: string) => string | undefined;
};
