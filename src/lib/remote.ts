import { output, webSocketSettings } from "../client";
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
};

export const initiateRemoteCommunicationChannelSocket = async (protocol: string) => {
    const ReconnectingWebSocket = (await import("reconnecting-websocket")).default;
    const socket = new ReconnectingWebSocket(
        `${protocol + location.hostname + (location.port ? ":" + location.port : "")}/terminals/remote-communication-channel/`,
        [],
        webSocketSettings,
    );

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
            case "openUrl": {
                const url = messageData.data;
                console.debug(`Opening URL: ${url}`);
                window.open(url, "_blank");
                break;
            }
            case "notifyAboutUrl": {
                const { url, port, name } = messageData.data;

                const openUrlButton = document.createElement("button");
                openUrlButton.innerText = "Open URL";
                openUrlButton.onclick = () => {
                    window.open(url, "_blank");
                };

                if (name) {
                    output(`${name} on port ${port} has been opened`, { formActions: [openUrlButton], reason: "info" });
                    break;
                }

                output(`Port ${port} has been opened`, { formActions: [openUrlButton], reason: "info" });
                break;
            }
            case "confirmExit": {
                // Ask for confirmation before closing the current terminal session
                window.onbeforeunload = (e: BeforeUnloadEvent) => {
                    e.preventDefault();
                    e.returnValue = "Are you sure you want to close the terminal?";
                };
            }
            default:
                console.debug("Unhandled message", messageData);
        }

        window.handledMessages.push(messageData.id);
        console.debug(`Handled message: ${messageData.id}`);
    };
};
