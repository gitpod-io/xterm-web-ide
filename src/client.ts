import type ReconnectingWebSocket from "reconnecting-websocket";
import fetchBuilder from "fetch-retry";
import type { Terminal, ITerminalOptions, ITerminalAddon } from "xterm";

import { AttachAddon } from "xterm-addon-attach";
import { FitAddon } from "xterm-addon-fit";
import type { WebglAddon } from "xterm-addon-webgl";

import { resizeRemoteTerminal } from "./lib/remote";
import { IWindowWithTerminal } from "./lib/types";
import { webLinksHandler } from "./lib/addons";
import { runFakeTerminal } from "./lib/fakeTerminal";

const maxReconnectionRetries = 50;

const fetchOptions = {
    retries: maxReconnectionRetries,
    retryDelay: (attempt: number, _error: Error, _response: Response) => {
        return Math.pow(1.25, attempt) * 200;
    },
    retryOn: (attempt: number, error: Error, response: Response) => {
        let responseSize = 0;
        if (!error && response.ok) {
            responseSize = parseInt(response.headers.get("content-length") || '0');
        }

        if (error !== null || response.status >= 400 || responseSize > 10) {
            console.log(`retrying, attempt number ${attempt + 1}, ${(Math.pow(1.25, attempt) * 300) / 1000}`);
            return true;
        } else {
            console.warn("Not retrying")
            return false;
        }
    }
}

declare let window: IWindowWithTerminal;

let term: Terminal;
let protocol: string;
let socketURL: string;
let socket: ReconnectingWebSocket;
let pid: number;

const defaultFonts = ["JetBrains Mono", "Fira Code", "courier-new", "courier", "monospace"];

const terminalContainer = document.getElementById("terminal-container");

if (terminalContainer) {
    createTerminal(terminalContainer);
}

const webSocketSettings: ReconnectingWebSocket['_options'] = {
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
    extraTerminalAddons['webgl'] = new (await import("xterm-addon-webgl")).WebglAddon;
})()

function initAddons(term: Terminal): void {

    for (const addon of Object.values(extraTerminalAddons)) {
        term.loadAddon(addon);
    }

    term.unicode.activeVersion = '11';

    (extraTerminalAddons['webgl'] as WebglAddon).onContextLoss(() => {
        extraTerminalAddons['webgl'].dispose();
    });
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
    socket = new ReconnectingWebSocket(socketURL, [], webSocketSettings);
    socket.onopen = async () => {
        outputDialog.close();

        try {
            // Fix for weird supervisor-frontend behavior
            (document.querySelector(".gitpod-frame") as HTMLDivElement).style.visibility = 'hidden';
            (document.querySelector("body") as HTMLBodyElement).style.visibility = "visible";
        } catch { } finally {
            (document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement).focus();
        }

        await runRealTerminal(term, socket as WebSocket);
    };
    //@ts-ignore
    socket.onclose = handleDisconnected;
    //@ts-ignore
    socket.onerror = handleDisconnected;

    window.socket = socket;
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
reconnectButton.onclick = () => socket.reconnect();

function handleDisconnected(e: CloseEvent) {

    if (socket.retryCount < webSocketSettings.maxRetries) {
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
    initAddons(term);
}

function updateTerminalSize(): void {
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddon.fit();
}

window.onresize = () => updateTerminalSize();
