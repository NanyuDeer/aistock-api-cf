export const DEFAULT_THROTTLE_MS = 300;

let lastRequestTime = 0;

export async function throttle(ms: number = DEFAULT_THROTTLE_MS): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < ms) {
        const waitTime = ms - timeSinceLastRequest;
        await new Promise<void>(resolve => setTimeout(resolve, waitTime));
    }
    lastRequestTime = Date.now();
}

export function resetThrottle(): void {
    lastRequestTime = 0;
}

export function createThrottler(defaultMs: number = DEFAULT_THROTTLE_MS) {
    let lastTime = 0;
    return {
        async throttle(ms: number = defaultMs): Promise<void> {
            const now = Date.now();
            const diff = now - lastTime;
            if (diff < ms) {
                await new Promise<void>(r => setTimeout(r, ms - diff));
            }
            lastTime = Date.now();
        },
        reset(): void {
            lastTime = 0;
        }
    };
}
