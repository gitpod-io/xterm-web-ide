const express = require('express');
const expressWs = require('express-ws');
const pty = require('node-pty');
const events = require('events');

const WebSocket = require('ws');
const argv = require('minimist')(process.argv.slice(2), { boolean: ["openExternal"] });

const port = process.env.PORT || 23000,
  host = '0.0.0.0';

function startServer() {
  const app = express();
  expressWs(app);

  const terminals = {};
  const logs = {};

  const initTerminal = (term) => {
    term.write(`export GP_EXTERNAL_BROWSER="node '/ide/index.cjs --openExternal --port ${port} ${term.pid}'"\r`);
    //term.write(`export GP_EXTERNAL_BROWSER="node /workspace/xterm-web-ide/dist/index.cjs --openExternal ${term.pid} --port ${port}"\r`);
    term.write('clear\r');
  }

  app.get('/', (_req, res) => { // lgtm [js/missing-rate-limiting]
    res.sendFile(__dirname + '/index.html');
  });

  app.use('/dist', express.static(__dirname + '/dist'));
  app.use('/assets', express.static(__dirname + '/assets'));
  app.use('/src', express.static(__dirname + '/src'));

  app.post('/terminals', (req, res) => {
    const env = Object.assign(process.env, {});
    env['COLORTERM'] = 'truecolor';
    const cols = parseInt(req.query.cols);
    const rows = parseInt(req.query.rows);

    if (Object.keys(terminals).length > 0) {
      const term = Object.values(terminals)[0];
      console.log(`Using existing terminal with PID ${term.pid}`);
      res.send(term.pid.toString());
      res.end();
      return;
    }

    const term = pty.spawn('bash', [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: env.GITPOD_REPO_ROOT || env.PWD,
      env,
      encoding: null
    });
    initTerminal(term);

    console.log(`Created terminal with PID: ${term.pid}`);
    terminals[term.pid] = term;
    logs[term.pid] = '';

    term.onData((data) => {
      logs[term.pid] += data;
    });

    term.onExit((_e) => {
      delete terminals[term.pid];
      console.log(`Closed terminal ${term.pid}`);
    });

    res.statusCode = 201; // HTTP 201 Created
    res.send(term.pid.toString());
    res.end();
  });

  app.post('/terminals/:pid/size', (req, res) => {
    const pid = parseInt(req.params.pid),
      cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = terminals[pid];

    term.resize(cols, rows);
    console.log(`Resized terminal ${pid} to ${cols} cols and ${rows} rows.`);
    res.end();
  });

  const em = new events.EventEmitter();
  app.ws('/terminals/remote-communication-channel/:pid', (ws, req) => {

    const pid = parseInt(req.params.pid);

    if (!terminals[pid]) {
      console.error("Should not connect to missing terminal");
    }

    console.log(`Client joined remote communication channel of ${pid}`);

    ws.on('message', (msg) => {
      try {
        msg = JSON.parse(msg);
      } catch (e) {
        console.error('Invalid JSON');
        return;
      }

      em.emit('message', msg);
      console.log(`Client sent message to terminal ${pid}: ${JSON.stringify(msg)}`);
    });

    em.on('message', (msg) => {
      ws.send(JSON.stringify(msg));
    });

  });

  app.ws('/terminals/:pid', (ws, req) => {
    const term = terminals[parseInt(req.params.pid)];
    console.log(`Client connected to terminal ${term.pid}`);
    ws.send(logs[term.pid]);

    // binary message buffering
    function bufferUtf8(socket, timeout) {
      let buffer = [];
      let sender = null;
      let length = 0;
      return (data) => {
        buffer.push(data);
        length += data.length;
        if (!sender) {
          sender = setTimeout(() => {
            socket.send(Buffer.concat(buffer, length));
            buffer = [];
            sender = null;
            length = 0;
          }, timeout);
        }
      };
    }
    const send = bufferUtf8(ws, 5);

    // WARNING: This is a naive implementation that will not throttle the flow of data. This means
    // it could flood the communication channel and make the terminal unresponsive. Learn more about
    // the problem and how to implement flow control at https://xtermjs.org/docs/guides/flowcontrol/
    term.on('data', (data) => {
      try {
        send(data);
      } catch (ex) {
        // The WebSocket is not open, ignore
      }
    });

    term.on('exit', ((_e) => {
      ws.send(`\r\nThis terminal has been closed. Refresh the page to create a new one.`);
    }));

    ws.on('message', (msg) => {
      term.write(msg);
    });
    ws.on('close', () => {
      console.log(`Client closed terminal ${term.pid}`);
    });
  });

  console.log(`App listening to http://127.0.0.1:${port}`);
  app.listen(port, host);
}

if (argv.openExternal) {
  const pid = argv._[0];
  const url = argv._[1];
  const { port } = argv;

  if (!pid) {
    console.error("Please provide a PID");
    process.exit(1);
  }

  const ws = new WebSocket(`ws://localhost:${port}/terminals/remote-communication-channel/${pid}`);
  console.log(`ws://localhost:${port}/terminals/remote-communication-channel/${pid}`)
  ws.on('open', () => {
    ws.send(JSON.stringify({ action: "openUrl", data: url || "https://gitpod.io" }));
    console.info("Sent openUrl message");
    ws.close();
    process.exit(0);
  });
} else {
  if (require.main === module) {
    startServer()
  }
}

module.exports = startServer;
