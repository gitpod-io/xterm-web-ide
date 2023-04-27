/**
 * Debounces a function by limiting the rate at which it is called.
 * The debounced function will be called immediately when first called,
 * and then at most once every `wait` milliseconds during subsequent calls.
 * If `trailing` is set to `true`, the function will also be called once
 * after the last event is triggered.
 *
 * @param {() => void} func - The function to be debounced.
 * @param {number} wait - The number of milliseconds to wait before allowing the function to be called again.
 * @param {boolean} trailing - Whether to call the function once after the last event is triggered.
 * @returns {() => void} - The debounced function.
 */
export const debounce = (func: () => void, wait: number, trailing: boolean): () => void => {
    let timeout: NodeJS.Timeout | null = null;

    return () => {
        const later = () => {
            timeout = null;
            if (trailing) {
                func();
            }
        };

        if (timeout === null) {
            func();
        } else {
            clearTimeout(timeout);
        }
        timeout = setTimeout(later, wait);
    };
}

export const isWindows =
    ["Windows", "Win16", "Win32", "WinCE"].includes(navigator.platform);