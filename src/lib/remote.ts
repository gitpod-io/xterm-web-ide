import { webSocketSettings } from "../client";

export const resizeRemoteTerminal = (size: { cols: number; rows: number }, pid: number) => {
    if (!pid) {
        return;
    }
    const cols = size.cols;
    const rows = size.rows;
    const url = `/terminals/${pid}/size?cols=${cols}&rows=${rows}`;

    fetch(url, { method: "POST" });
}

export const initiateRemoteCommunicationChannelSocket = async (protocol: string, pid: number) => {
    const ReconnectingWebSocket = (await import("reconnecting-websocket")).default;
    const socket = new ReconnectingWebSocket(`${protocol + location.hostname + (location.port ? ":" + location.port : "")}/terminals/remote-communication-channel/${pid}`, [], webSocketSettings);

    socket.onopen = () => {
        console.debug("External messaging channel socket opened");
    };

    socket.onmessage = (event) => {
        const messageData = JSON.parse(event.data);
        if (messageData.action === "openUrl") {
            const url = messageData.data;
            console.debug(`Opening URL: ${url}`);
            window.open(url, "_blank");
        }
    };
};
