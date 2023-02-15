import ReconnectingWebSocket from "reconnecting-websocket";
import { Terminal, ITerminalOptions } from "xterm";

import { AttachAddon } from "xterm-addon-attach";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { WebglAddon } from "xterm-addon-webgl";
import { Unicode11Addon } from "xterm-addon-unicode11";
// todo: this does not work and results in ESM issues import { LigaturesAddon } from "xterm-addon-ligatures";

import { resizeRemoteTerminal } from "./lib/remote";

export interface IWindowWithTerminal extends Window {
    term: Terminal;
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

function createTerminal(element: HTMLElement): void {
    // Clean terminal
    while (element.children.length) {
        element.removeChild(element.children[0]);
    }

    const isWindows =
        ["Windows", "Win16", "Win32", "WinCE"].indexOf(navigator.platform) >= 0;
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
    setTimeout(() => {
        updateTerminalSize();

        fetch(`/terminals?cols=${term.cols}&rows=${term.rows}`, {
            method: "POST",
        }).then((res) => {
            res.text().then((processId) => {
                pid = parseInt(processId);
                socketURL += processId;
                socket = new ReconnectingWebSocket(socketURL, [], {
                    connectionTimeout: 1000,
                    maxRetries: 20,
                });
                socket.onopen = () => {
                    outputDialog.close();
                    runRealTerminal(term, socket as WebSocket); 
                };
                //@ts-ignore
                socket.onclose = handleDisconnected;
                //@ts-ignore
                socket.onerror = handleDisconnected;
            });
        });
    }, 0);
}

const reloadButton = document.createElement("button");
reloadButton.innerText = "Reload";
reloadButton.onclick = () => location.reload();

function handleDisconnected(e: CloseEvent) {
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
                formActions: [reloadButton],
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

const fitAddon = new FitAddon();
const webglAddon = new WebglAddon();
const webLinksAddon = new WebLinksAddon();
const unicodeAddon = new Unicode11Addon();

let attachAddon: AttachAddon;

function runRealTerminal(terminal: Terminal, socket: WebSocket): void {
    attachAddon = new AttachAddon(socket);
    terminal.loadAddon(attachAddon);
    initAddons(term);
}

function initAddons(term: Terminal): void {
    term.loadAddon(fitAddon);
    term.loadAddon(webglAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(unicodeAddon);
}

function updateTerminalSize(): void {
    //@ts-ignore
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddon.fit();
}

window.onresize = () => updateTerminalSize();
