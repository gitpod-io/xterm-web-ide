import type { Terminal } from "xterm";

export function runFakeTerminal(term: Terminal, message = "Loading IDE") {
    const numDots = 3;
    let currentDot = 0;
    term.write(message);
    const loadingIconInterval = setInterval(() => {
        term.write('.');
        if (currentDot++ === numDots) {
            term.write('\r\x1b[K');
            term.write(message);
            currentDot = 0;
        }
    }, 450);
    return loadingIconInterval;
}