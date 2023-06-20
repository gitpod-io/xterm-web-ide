import type { Terminal } from "xterm";
import { webSocketSettings } from "../client";
import { IXtermWindow } from "./types";

declare let window: IXtermWindow;

export const resizeRemoteTerminal = async (size: { cols: number; rows: number }, pid: number) => {
    if (!pid) {
        return;
    }
    const cols = size.cols;
    const rows = size.rows;
    const url = `/terminals/${pid}/size?cols=${cols}&rows=${rows}`;

    try {
        await fetch(url, { method: "POST" });
    } catch (e) {
        console.error(`Failed to resize the remote shell: ${e}`);
    }
}

type TerminalState = 'open' | 'closed';

export const initiateRemoteCommunicationChannelSocket = async (protocol: string, pid: number, terminal: Terminal) => {
    const ReconnectingWebSocket = (await import("reconnecting-websocket")).default;
    const socket = new ReconnectingWebSocket(`${protocol + location.hostname + (location.port ? ":" + location.port : "")}/terminals/remote-communication-channel/${pid}`, [], webSocketSettings);

    socket.onopen = () => {
        console.debug("External messaging channel socket opened");
    };

    socket.onmessage = (event) => {
        if (!event.data) {
            console.warn("Received empty message");
            return;
        }

        const messageData = JSON.parse(event.data);
        if (window.handledMessages.includes(messageData.id)) {
            console.debug(`Message already handled: ${messageData.id}`);
            return;
        }

        switch (messageData.action) {
            case "openUrl":
                const url = messageData.data;
                console.debug(`Opening URL: ${url}`);
                window.open(url, "_blank");
            case "stateUpdate":
                const newState: TerminalState = messageData.data;
                switch (newState) {
                    case "closed": {
                        console.warn("Should close terminal");
                        if (terminal.element?.parentElement?.classList.contains("wb-body")) {
                            terminal.element.parentElement?.parentElement?.remove()
                        }
                    }
                }
        }

        window.handledMessages.push(messageData.id);
        console.debug(`Handled message: ${messageData.id}`);
    };
};
