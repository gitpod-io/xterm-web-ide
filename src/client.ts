import ReconnectingWebSocket from "reconnecting-websocket";
import { Terminal, ITerminalOptions } from "xterm";

import { AttachAddon } from "xterm-addon-attach";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { WebglAddon } from "xterm-addon-webgl";
import { Unicode11Addon } from "xterm-addon-unicode11";
//import { LigaturesAddon } from 'xterm-addon-ligatures';

import { Addon, AddonType } from "./lib/types";

export interface IWindowWithTerminal extends Window {
    term: Terminal;
}
declare let window: IWindowWithTerminal;

let term: any;
let protocol: string;
let socketURL: string;
let socket: ReconnectingWebSocket;
let pid: number;

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
        fontFamily: "Fira Code, courier-new, courier, monospace",
    } as ITerminalOptions);

    window.term = term; // Expose `term` to window for debugging purposes
    term.onResize((size: { cols: number; rows: number }) => {
        if (!pid) {
            return;
        }
        const cols = size.cols;
        const rows = size.rows;
        const url = `/terminals/${pid}/size?cols=${cols}&rows=${rows}`;

        fetch(url, { method: "POST" });
    });
    protocol = location.protocol === "https:" ? "wss://" : "ws://";
    socketURL = `${protocol + location.hostname + (location.port ? ":" + location.port : "")
        }/terminals/`;

    term.open(element);
    //addons.fit.instance!.fit();
    term.focus();

    // fit is called within a setTimeout, cols and rows need this.
    setTimeout(() => {
        // Set terminal size again to set the specific dimensions on the demo
        //updateTerminalSize();

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
                socket.onopen = runRealTerminal;
                //@ts-ignore
                socket.onclose = handleDisconected;
                //@ts-ignore
                socket.onerror = handleDisconected;
            });
        });
    }, 0);
}

const reloadButton = document.createElement("button");
reloadButton.innerText = "Reload";
reloadButton.onclick = () => location.reload();

function handleDisconected(e: CloseEvent) {
    console.error(e);
    alert(e);
    switch (e.code) {
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
}

const outputDialog = document.getElementById("output")!;
const outputContent = document.getElementById("outputContent")!;
function output(
    message: string,
    options?: { formActions: HTMLInputElement[] | HTMLButtonElement[] }
) {
    //@ts-ignore
    if (typeof outputDialog.showModal === "function") {
        outputContent.innerText = message;
        if (options?.formActions) {
            for (const action of options.formActions) {
                outputDialog.querySelector("form")!.appendChild(action);
            }
        }
        //@ts-ignore
        outputDialog.showModal();
    }
}

function runRealTerminal(): void {
    addons.attach.instance = new AttachAddon(socket as WebSocket);
    term.loadAddon(addons.attach.instance);
    term._initialized = true;
    initAddons(term);
}

const addons: { [T in AddonType]: Addon<T> } = {
    attach: { name: "attach", ctor: AttachAddon, canChange: false },
    fit: { name: "fit", ctor: FitAddon, canChange: false },
    "web-links": { name: "web-links", ctor: WebLinksAddon, canChange: false },
    webgl: { name: "webgl", ctor: WebglAddon, canChange: true },
    unicode11: { name: "unicode11", ctor: Unicode11Addon, canChange: false },
    ligatures: { name: "ligatures", ctor: Unicode11Addon, canChange: true },
};

function initAddons(term: Terminal): void {
    Object.keys(addons).forEach((name: any) => {
        const addon = addons[name as AddonType];
        //@ts-ignore
        addon.instance = new addon.ctor();
        term.loadAddon(addon.instance);
        if (addon.name === "unicode11") {
            term.unicode.activeVersion = "11";
        }
        addon.instance!.dispose();
        addon.instance = undefined;
    });
}

function updateTerminalSize(): void {
    //@ts-ignore
    addons.fit.instance.fit();
}

window.onresize = () => updateTerminalSize();

function addDomListener(
    element: HTMLElement,
    type: string,
    handler: (...args: any[]) => any
): void {
    element.addEventListener(type, handler);
    term._core.register({
        dispose: () => element.removeEventListener(type, handler),
    });
}

