/// <reference types='@gitpod/gitpod-protocol/lib/typings/globals'/>

import { DisposableCollection } from "@gitpod/gitpod-protocol";
import { createTerminal, updateTerminalSize } from "./client";
import { debounce } from "./lib/helpers";

declare global {
    interface Window {
        WinBox: typeof import("winbox");
    }
}

export async function createTerminalWindow() {
    // Create element for terminal
    const terminalElement = document.createElement("div");

    const toDispose = new DisposableCollection();
    toDispose.push({
        dispose: () => {
        }
    })

    //@ts-ignore
    const terminalWindow = new WinBox({
        title: "Terminal",
        width: "800px",
        height: "400px",
        x: "center",
        y: "center",
        root: terminalElement,
    });

    document.body.appendChild(terminalElement);

    const { terminal, socket } = await createTerminal(terminalWindow.body, toDispose);
    terminalWindow.onresize = debounce(() => updateTerminalSize(terminal), 200, true);
    terminalWindow.onclose = (_force) => {
        socket.close(); 
        return false
    };
}

createTerminalWindow();

export { };
