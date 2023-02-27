// Send WebSocket requests to the server

const WebSocket = require('ws');

const pid = process.argv[2];
const url = process.argv[3];

if (!pid) {
    console.error("Please provide a PID");
    process.exit(1);
}

const ws = new WebSocket(`ws://localhost:23000/terminals/remote-communication-channel/${pid}`);

ws.on('open', () => {
    ws.send(JSON.stringify({ action: "openUrl", data: url || "https://gitpod.io" }));
    console.info("Sent openUrl message");
    ws.close();
    process.exit(0);
})