/// <reference types='@gitpod/gitpod-protocol/lib/typings/globals'/>

import type { IDEFrontendState } from '@gitpod/gitpod-protocol/lib/ide-frontend-service';

import type ReconnectingWebSocket from "reconnecting-websocket";
import fetchBuilder from "fetch-retry";
import type { Terminal, ITerminalOptions, ITerminalAddon } from "xterm";

import { AttachAddon } from "xterm-addon-attach";
import { FitAddon } from "xterm-addon-fit";

import { resizeRemoteTerminal } from "./lib/remote";
import { IXtermWindow } from "./lib/types";
import { webLinksHandler } from "./lib/addons";
import { initiateRemoteCommunicationChannelSocket } from "./lib/remote";
import { Emitter } from '@gitpod/gitpod-protocol/lib/util/event';
import { DisposableCollection } from '@gitpod/gitpod-protocol/lib/util/disposable';
import { debounce, isWindows } from './lib/helpers';
import "./lib/pallete";

const onDidChangeState = new Emitter<void>();
let state: IDEFrontendState = "initializing" as IDEFrontendState;

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

export const webSocketSettings: ReconnectingWebSocket['_options'] = {
    connectionTimeout: 5000,
    maxReconnectionDelay: 7000,
    minReconnectionDelay: 500,
    maxRetries: maxReconnectionRetries,
    debug: false,
}

const extraTerminalAddons: { [key: string]: ITerminalAddon } = {};

(async () => {
    extraTerminalAddons['ligatures'] = new (await import("xterm-addon-ligatures")).LigaturesAddon();
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
        });
        return;
    }

    const serverProcessId = await initialTerminalResizeRequest.text();
    console.debug(`Got PID from server: ${serverProcessId}`);

    pid = parseInt(serverProcessId);
    socketURL += serverProcessId;

    await initiateRemoteCommunicationChannelSocket(protocol, pid);
    let socket = new ReconnectingWebSocket(socketURL, [], webSocketSettings);
    socket.onopen = async () => {
        outputDialog.close();
        (document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement).focus();

        await runRealTerminal(term, socket as WebSocket);
    };
    //@ts-ignore
    socket.onclose = (e) => handleDisconnected(e, socket);
    //@ts-ignore
    socket.onerror = (e) => handleDisconnected(e, socket);

    return socket;
}

export async function createTerminal(element: HTMLElement, toDispose: DisposableCollection): Promise<{terminal: Terminal; socket: ReconnectingWebSocket}> {
    // Clean terminal
    while (element.children.length) {
        element.removeChild(element.children[0]);
    }

    const { Terminal } = (await import("xterm"));

    term = new Terminal({
        windowsMode: isWindows,
        fontFamily: defaultFonts.join(", "),
        allowProposedApi: true
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

    let buffer = '';
    term.onData((data) => {
        buffer += data;

        const unwantedSequence = '\x1b[0;276;0c';
        if (buffer.includes(unwantedSequence)) {
            buffer = buffer.replaceAll(unwantedSequence, '');
            term.write(buffer);
        }
        buffer = '';
    });

    toDispose.push(term);

    window.terminal = term;
    term.onResize(async (size) => {
        await resizeRemoteTerminal(size, pid);
        console.info(`Resized remote terminal to ${size.cols}x${size.rows}`);
    });

    protocol = location.protocol === "https:" ? "wss://" : "ws://";
    socketURL = `${protocol + location.hostname + (location.port ? ":" + location.port : "")
        }/terminals/`;

    term.open(element);
    updateTerminalSize(term);
    term.focus();

    const terminalSocket = await initiateRemoteTerminal(term);

    if (!terminalSocket) {
        throw new Error("Coudln't set up a remote connection to the terminal process");
    }

    const debouncedUpdateTerminalSize = debounce(() => updateTerminalSize(term), 200, true);
    element.onresize = () => debouncedUpdateTerminalSize();

    return {terminal: term, socket: terminalSocket};
}

const reloadButton = document.createElement("button");
reloadButton.innerText = "Reload page";
reloadButton.onclick = () => location.reload();

const reconnectButton = document.createElement("button");
reconnectButton.innerText = "Reconnect";
reconnectButton.onclick = () => window.socket.reconnect();

function handleDisconnected(e: CloseEvent, socket: ReconnectingWebSocket) {

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
    await initAddons(term);

    state = "ready";
    onDidChangeState.fire();
}

export function updateTerminalSize(terminal: Terminal): void {
    console.debug("Updating terminal size");
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
            }
        })
        const terminalContainer = document.getElementById("terminal-container");
        if (terminalContainer && !terminalContainer.classList.contains("init")) {
            //createTerminal(terminalContainer, toDispose);
            terminalContainer.classList.add("init");
        }
        return toDispose;
    }
};
