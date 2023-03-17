import type ReconnectingWebSocket from "reconnecting-websocket";
import fetchBuilder from "fetch-retry";
import type { Terminal, ITerminalOptions, ITerminalAddon } from "xterm";

import { AttachAddon } from "xterm-addon-attach";
import { FitAddon } from "xterm-addon-fit";

import { resizeRemoteTerminal } from "./lib/remote";
import { IXtermWindow } from "./lib/types";
import { webLinksHandler } from "./lib/addons";
import { runFakeTerminal } from "./lib/fakeTerminal";
import { initiateRemoteCommunicationChannelSocket } from "./lib/remote";

const maxReconnectionRetries = 50;

const fetchOptions = {
    retries: maxReconnectionRetries,
    retryDelay: (attempt: number, _error: Error, _response: Response) => {
        return Math.pow(1.25, attempt) * 200;
    },
    retryOn: (attempt: number, error: Error, response: Response) => {
        if (error !== null || response.status >= 400) {
            console.log(`retrying, attempt number ${attempt + 1}, ${(Math.pow(1.25, attempt) * 300) / 1000}`);
            return true;
        } else {
            console.warn("Not retrying")
            return false;
        }
    }
}

declare let window: IXtermWindow;

let term: Terminal;
let protocol: string;
let socketURL: string;
let pid: number;
window.handledMessages = [];

const defaultFonts = ["JetBrains Mono", "Fira Code", "courier-new", "courier", "monospace"];

const terminalContainer = document.getElementById("terminal-container");

if (terminalContainer && !terminalContainer.classList.contains("init")) {
    createTerminal(terminalContainer);
    terminalContainer.classList.add("init");
}

export const webSocketSettings: ReconnectingWebSocket['_options'] = {
    connectionTimeout: 5000,
    maxReconnectionDelay: 7000,
    minReconnectionDelay: 500,
    maxRetries: maxReconnectionRetries,
    debug: true,
}

const extraTerminalAddons: { [key: string]: ITerminalAddon } = {};

(async () => {
    extraTerminalAddons['ligatures'] = new (await import("xterm-addon-ligatures")).LigaturesAddon();
    extraTerminalAddons['fit'] = new (await import("xterm-addon-fit")).FitAddon();
    extraTerminalAddons['unicode'] = new (await import("xterm-addon-unicode11")).Unicode11Addon();
    extraTerminalAddons['webLinks'] = new (await import("xterm-addon-web-links")).WebLinksAddon(webLinksHandler);
})()

async function initAddons(term: Terminal): Promise<void> {
    for (const addon of Object.values(extraTerminalAddons)) {
        term.loadAddon(addon);
    }

    const webglRenderer = new (await import("xterm-addon-webgl")).WebglAddon;
    try {
        term.loadAddon(webglRenderer);
        webglRenderer.onContextLoss(() => {
            webglRenderer.dispose();
        });
    } catch (e) {
        console.warn(`Webgl renderer could not be loaded. Falling back to the canvas renderer type.`, e);
        webglRenderer.dispose();
        const canvasRenderer = new (await import("xterm-addon-canvas")).CanvasAddon;
        term.loadAddon(canvasRenderer);
    }

    term.unicode.activeVersion = '11';
}

async function initiateRemoteTerminal() {
    updateTerminalSize();

    const ReconnectingWebSocket = (await import("reconnecting-websocket")).default;

    const fetcher = fetchBuilder(fetch, fetchOptions);
    const initialTerminalResizeRequest = await fetcher(`/terminals?cols=${term.cols}&rows=${term.rows}`, {
        method: "POST",
        credentials: "include",
    });

    if (!initialTerminalResizeRequest.ok) {
        output("Could not setup IDE. Retry?", {
            formActions: [reloadButton],
        });
        return;
    }

    const serverProcessId = await initialTerminalResizeRequest.text();
    console.debug(`Got PID from server: ${serverProcessId}`);

    pid = parseInt(serverProcessId);
    socketURL += serverProcessId;

    await initiateRemoteCommunicationChannelSocket(protocol);
    window.socket = new ReconnectingWebSocket(socketURL, [], webSocketSettings);
    window.socket.onopen = async () => {
        outputDialog.close();

        try {
            // Fix for weird supervisor-frontend behavior
            (document.querySelector(".gitpod-frame") as HTMLDivElement).hidden = true;
            (document.querySelector("body") as HTMLBodyElement).hidden = false;
        } catch { } finally {
            (document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement).focus();
        }

        await runRealTerminal(term, window.socket as WebSocket);
    };
    //@ts-ignore
    window.socket.onclose = handleDisconnected;
    //@ts-ignore
    window.socket.onerror = handleDisconnected;
}

async function createTerminal(element: HTMLElement): Promise<void> {
    // Clean terminal
    while (element.children.length) {
        element.removeChild(element.children[0]);
    }

    const isWindows =
        ["Windows", "Win16", "Win32", "WinCE"].indexOf(navigator.platform) >= 0;

    const { Terminal } = (await import("xterm"));

    term = new Terminal({
        windowsMode: isWindows,
        fontFamily: defaultFonts.join(", "),
        allowProposedApi: true
    } as ITerminalOptions);

    window.term = term; // Expose `term` to window for debugging purposes
    term.onResize((size) => {
        resizeRemoteTerminal(size, pid);
    });
    protocol = location.protocol === "https:" ? "wss://" : "ws://";
    socketURL = `${protocol + location.hostname + (location.port ? ":" + location.port : "")
        }/terminals/`;

    term.open(element);
    updateTerminalSize();
    term.focus();

    // fit is called within a setTimeout, cols and rows need this.
    setTimeout(async () => {
        const interval = runFakeTerminal(term);
        await initiateRemoteTerminal();
        clearInterval(interval);
    }, 0);
}

const reloadButton = document.createElement("button");
reloadButton.innerText = "Reload page";
reloadButton.onclick = () => location.reload();

const reconnectButton = document.createElement("button");
reconnectButton.innerText = "Reconnect";
reconnectButton.onclick = () => window.socket.reconnect();

function handleDisconnected(e: CloseEvent) {

    if (window.socket.retryCount < webSocketSettings.maxRetries) {
        console.info("Tried to reconnect WS")
        return;
    }

    switch (e.code) {
        case 1000:
            if (e.reason === "timeout") {
                location.reload();
            }
        case 1001:
            // This error happens every page reload, ignore
            break;
        case 1005:
            output("For some reason the WebSocket closed. Reload?", {
                formActions: [reconnectButton, reloadButton],
            });
        case 1006:
            if (navigator.onLine) {
                output("Cannot reach workspace, consider reloading", {
                    formActions: [reloadButton],
                });
            } else {
                output(
                    "You are offline, please connect to the internet and refresh this page"
                );
            }
            break;
    }
    console.error(e);
}

const outputDialog = document.getElementById("output") as HTMLDialogElement;
const outputContent = document.getElementById("outputContent")!;
function output(
    message: string,
    options?: { formActions: HTMLInputElement[] | HTMLButtonElement[] }
) {
    if (typeof outputDialog.showModal === "function") {
        outputContent.innerText = message;
        if (options?.formActions) {
            for (const action of options.formActions) {
                outputDialog.querySelector("form")!.appendChild(action);
            }
        }
        outputDialog.showModal();
    }
}

let attachAddon: AttachAddon;

async function runRealTerminal(terminal: Terminal, socket: WebSocket): Promise<void> {
    console.info("WS connection established. Trying to attach it to the terminal");
    term.reset();
    attachAddon = new AttachAddon(socket);
    terminal.loadAddon(attachAddon);
    await initAddons(term);
}

function updateTerminalSize(): void {
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddon.fit();
}

window.onresize = () => updateTerminalSize();
