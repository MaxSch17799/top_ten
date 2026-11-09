

export type Act = (type: string, payload?: Record<string, unknown>) => Promise<void>;
