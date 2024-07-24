/// <reference types='@gitpod/gitpod-protocol/lib/typings/globals'/>

import type { IDEFrontendState } from "@gitpod/gitpod-protocol/lib/ide-frontend-service";

import type ReconnectingWebSocket from "reconnecting-websocket";
import fetchBuilder from "fetch-retry";
import type { Terminal, ITerminalOptions, ITerminalAddon } from "@xterm/xterm";

import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";

import { resizeRemoteTerminal } from "./lib/remote";
import { IXtermWindow } from "./lib/types";
import { webLinksHandler } from "./lib/addons";
import { isWindows } from "./lib/helpers";
import { initiateRemoteCommunicationChannelSocket } from "./lib/remote";

import { Emitter } from "@gitpod/gitpod-protocol/lib/util/event";
import { DisposableCollection } from "@gitpod/gitpod-protocol/lib/util/disposable";
import debounce from "lodash/debounce";

const onDidChangeState = new Emitter<void>();
let state: IDEFrontendState = "initializing" as IDEFrontendState;

const maxReconnectionRetries = 50;

const fetchOptions = {
    retries: maxReconnectionRetries,
    retryDelay: (attempt: number, _error: Error | null, _response: Response | null) => {
        return Math.pow(1.25, attempt) * 200;
    },
    retryOn: (attempt: number, error: Error | null, response: Response | null) => {
        if (error !== null || (response?.status ?? 0) >= 400) {
            console.log(`retrying, attempt number ${attempt + 1}, ${(Math.pow(1.25, attempt) * 300) / 1000}`);
            return true;
        } else {
            console.warn("Not retrying");
            return false;
        }
    },
};

declare let window: IXtermWindow;

let term: Terminal;
let protocol: string;
let socketURL: string;
let pid: number;
window.handledMessages = [];

const defaultFonts = ["JetBrains Mono", "Fira Code", "courier-new", "courier", "monospace"];

export const webSocketSettings: ReconnectingWebSocket["_options"] = {
    connectionTimeout: 5000,
    maxReconnectionDelay: 7000,
    minReconnectionDelay: 500,
    maxRetries: maxReconnectionRetries,
    debug: false,
};

const extraTerminalAddons: { [key: string]: ITerminalAddon } = {};

(async () => {
    extraTerminalAddons["ligatures"] = new (await import("@xterm/addon-ligatures")).LigaturesAddon();
    extraTerminalAddons["unicode"] = new (await import("@xterm/addon-unicode11")).Unicode11Addon();
    extraTerminalAddons["webLinks"] = new (await import("@xterm/addon-web-links")).WebLinksAddon(webLinksHandler);
})();

async function initAddons(term: Terminal): Promise<void> {
    for (const addon of Object.values(extraTerminalAddons)) {
        term.loadAddon(addon);
    }

    const webglRenderer = new (await import("@xterm/addon-webgl")).WebglAddon();

    try {
        term.loadAddon(webglRenderer);
        console.debug("Loaded webgl renderer");
        webglRenderer.onContextLoss(() => {
            webglRenderer.dispose();
        });
    } catch (e) {
        console.warn(`Webgl renderer could not be loaded. Falling back to the canvas renderer type.`, e);
        webglRenderer.dispose();

        const canvasRenderer = new (await import("@xterm/addon-canvas")).CanvasAddon();
        term.loadAddon(canvasRenderer);
    }

    term.unicode.activeVersion = "11";
}

async function initiateRemoteTerminal(terminal: Terminal): Promise<void | ReconnectingWebSocket> {
    updateTerminalSize(terminal);

    const ReconnectingWebSocket = (await import("reconnecting-websocket")).default;

    const fetcher = fetchBuilder(fetch, fetchOptions);
    const initialTerminalResizeRequest = await fetcher(`/terminals?cols=${term.cols}&rows=${term.rows}`, {
        method: "POST",
        credentials: "include",
    });

    if (!initialTerminalResizeRequest.ok) {
        output("Could not setup IDE. Retry?", {
            formActions: [reloadButton],
            reason: "error",
        });
        return;
    }

    const serverProcessId = await initialTerminalResizeRequest.text();
    console.debug(`Got PID from server: ${serverProcessId}`);

    pid = parseInt(serverProcessId);
    socketURL += serverProcessId;

    await initiateRemoteCommunicationChannelSocket(protocol);

    const socket = new ReconnectingWebSocket(socketURL, [], webSocketSettings);
    socket.onopen = async () => {
        if (outputReasonInput.value === "error") {
            outputDialog.close();
        }
        (document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement).focus();

        await runRealTerminal(term, socket as WebSocket);
    };
    socket.onclose = (error) => handleDisconnected(error as CloseEvent, socket);
    socket.onerror = (error) => handleDisconnected(error as ErrorEvent, socket);

    return socket;
}

const reconnectButton = document.createElement("button");
reconnectButton.innerText = "Reconnect";

const reloadButton = document.createElement("button");
reloadButton.innerText = "Reload page";
reloadButton.onclick = () => location.reload();

async function createTerminal(
    element: HTMLElement,
    toDispose: DisposableCollection,
): Promise<{ terminal: Terminal; socket: ReconnectingWebSocket }> {
    // Clean terminal
    while (element.children.length) {
        element.removeChild(element.children[0]);
    }

    const { Terminal } = await import("@xterm/xterm");

    term = new Terminal({
        windowsMode: isWindows,
        fontFamily: defaultFonts.join(", "),
        allowProposedApi: true,
    } as ITerminalOptions);

    term.attachCustomKeyEventHandler((event) => {
        const ctrlCmd = isWindows ? event.ctrlKey : event.metaKey;
        switch (event.key) {
            case "k":
                if (ctrlCmd) {
                    event.preventDefault();
                    if (term) {
                        // todo: make sure this is propagated across clients
                        term.clear();
                        return false;
                    }
                }
                return true;
            case "F12":
                return false;
            default:
                return true;
        }
    });

    const unwantedSequence = "\x1b[0;276;0c";
    term.onData((data) => {
        if (data.includes(unwantedSequence)) {
            const cleanedData = data.replaceAll(unwantedSequence, "");
            term.write(cleanedData);
        }
    });

    toDispose.push(term);

    window.terminal = term;
    term.onResize(async (size) => {
        await resizeRemoteTerminal(size, pid);
        console.info(`Resized remote terminal to ${size.cols}x${size.rows}`);
    });

    protocol = location.protocol === "https:" ? "wss://" : "ws://";
    socketURL = `${protocol + location.hostname + (location.port ? ":" + location.port : "")}/terminals/`;

    term.open(element);
    updateTerminalSize(term);
    term.focus();

    const terminalSocket = await initiateRemoteTerminal(term);
    if (!terminalSocket) {
        throw new Error("Couldn't set up a remote connection to the terminal process");
    }

    const debouncedUpdateTerminalSize = debounce(() => updateTerminalSize(term), 200, { trailing: true });
    window.onresize = () => debouncedUpdateTerminalSize();

    // Register the onclick event for the reconnect button
    reconnectButton.onclick = () => terminalSocket.reconnect();

    return { terminal: term, socket: terminalSocket };
}

function handleDisconnected(e: CloseEvent | ErrorEvent, socket: ReconnectingWebSocket) {
    if (socket.retryCount < webSocketSettings.maxRetries) {
        console.info("Tried to reconnect WS, proceeding");
        return;
    }

    if (e instanceof CloseEvent) {
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
                    reason: "error",
                });
            case 1006:
                if (navigator.onLine) {
                    output("Cannot reach workspace, consider reloading", {
                        formActions: [reloadButton],
                        reason: "error",
                    });
                } else {
                    output("You are offline, please connect to the internet and refresh this page", {
                        reason: "error",
                    });
                }
                break;
            default:
                console.error(`Unhandled error event`, e);
        }
    }

    console.error(e);
}

type OutputReason = "info" | "error";

const dismissButton = document.createElement("button");
dismissButton.innerText = "Dismiss";

const outputDialog = document.getElementById("output") as HTMLDialogElement;
const outputContent = document.getElementById("outputContent") as HTMLParagraphElement;
const outputReasonInput = document.getElementById("outputReason") as HTMLInputElement;
const outputForm = outputDialog.querySelector("form") as HTMLFormElement;
export function output(
    message: string,
    options?: { formActions?: HTMLInputElement[] | HTMLButtonElement[]; reason?: OutputReason },
) {
    if (typeof outputDialog.showModal === "function") {
        outputContent.innerText = message;
        if (options?.formActions) {
            outputForm.innerHTML = "";
            outputForm.appendChild(dismissButton);
            for (const action of options.formActions) {
                outputForm.appendChild(action);
            }
        }
        outputReasonInput.value = options?.reason ?? "info";
        outputDialog.showModal();
    } else {
        console.error("Could not output, user agent does not support the dialog API.");
    }
}

let attachAddon: AttachAddon;

async function runRealTerminal(terminal: Terminal, socket: WebSocket): Promise<void> {
    console.info("WS connection established. Trying to attach it to the terminal");
    term.reset();
    attachAddon = new AttachAddon(socket);
    terminal.loadAddon(attachAddon);
    await initAddons(term);

    state = "ready";
    onDidChangeState.fire();
}

function updateTerminalSize(terminal: Terminal): void {
    if (!terminal) {
        console.warn("Terminal not yet initialized. Aborting resize.");
        return;
    }
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    fitAddon.fit();
}

window.gitpod.ideService = {
    get state() {
        return state;
    },
    get failureCause() {
        return undefined;
    },
    onDidChange: onDidChangeState.event,
    start: () => {
        const toDispose = new DisposableCollection();
        toDispose.push({
            dispose: () => {
                state = "terminated";
                onDidChangeState.fire();
            },
        });
        const terminalContainer = document.getElementById("terminal-container");
        if (terminalContainer && !terminalContainer.classList.contains("init")) {
            createTerminal(terminalContainer, toDispose).then(({ socket }) => {
                terminalContainer.classList.add("init");
                toDispose.push({
                    dispose: () => {
                        socket.close();
                    },
                });
            });
        }
        return toDispose;
    },
};
