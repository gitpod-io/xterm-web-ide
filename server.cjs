//@ts-check

const express = require('express');
const expressWs = require('express-ws');
const pty = require('node-pty');
const events = require('events');
const crypto = require('crypto');

const rateLimit = require('express-rate-limit').default;

const WebSocket = require('ws');
const argv = require('minimist')(process.argv.slice(2), { boolean: ["openExternal"] });

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 23000;
const host = '0.0.0.0';

const config = {
  reuseTerminals: false
}

const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: "Too many requests from this IP, please try again after 1 minute",
  standardHeaders: true,
  legacyHeaders: false,
});

function startServer() {
  const app = express();
  expressWs(app);

  const terminals = {};
  const logs = {};

  app.get('/', (_req, res) => {
    res.sendFile(__dirname + '/index.html');
  });

  app.get('/version', (_req, res) => {
    res.sendFile(__dirname + '/commit.txt');
  });

  app.use('/dist', express.static(__dirname + '/dist'));
  app.use('/assets', express.static(__dirname + '/assets'));
  app.use('/src', express.static(__dirname + '/src'));

  app.post('/terminals', rateLimiter, (req, res) => {
    if (!req.query.cols || !req.query.rows) {
      res.statusCode = 400;
      res.send('`cols` and `rows` are required');
      res.end();
      return;
    } else if (typeof req.query.cols !== 'string' || typeof req.query.rows !== 'string') {
      res.statusCode = 400;
      res.send('`cols` and `rows` must be strings');
      res.end();
      return;
    }

    const cols = parseInt(req.query.cols, 10);
    const rows = parseInt(req.query.rows, 10);

    if (isNaN(cols) || isNaN(rows)) {
      res.statusCode = 400;
      res.send('`cols` and `rows` must be parsable as integers');
      res.end();
      return;
    }

    if (config.reuseTerminals && Object.keys(terminals).length > 0) {
      const term = Object.values(terminals)[0];
      console.log(`Using existing terminal with PID ${term.pid}`);
      res.send(term.pid.toString());
      res.end();
      return;
    }

    const env = Object.assign({}, process.env);
    env['COLORTERM'] = 'truecolor';

    const term = pty.spawn(process.env.SHELL || '/bin/bash', [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: env.GITPOD_REPO_ROOT || env.PWD,
      env,
      encoding: null
    });

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

  app.post('/terminals/:pid/size', rateLimiter, (req, res) => {

    if (!req.query.cols || !req.query.rows) {
      res.statusCode = 400;
      res.send('`cols` and `rows` are required');
      res.end();
      return;
    } else if (typeof req.query.cols !== 'string' || typeof req.query.rows !== 'string') {
      res.statusCode = 400;
      res.send('`cols` and `rows` must be strings');
      res.end();
      return;
    }

    const cols = parseInt(req.query.cols, 10);
    const rows = parseInt(req.query.rows, 10);
    const pid = parseInt(req.params.pid);

    if (isNaN(cols) || isNaN(rows) || isNaN(pid)) {
      res.statusCode = 400;
      res.send('`cols`, `rows` & `pid` must be parsable as integers');
      res.end();
      return;
    }

    const term = terminals[pid];

    term.resize(cols, rows);
    console.log(`Resized terminal ${pid} to ${cols} cols and ${rows} rows.`);
    res.end();
  });

  const em = new events.EventEmitter();
  app.ws('/terminals/remote-communication-channel/', (ws, _req) => {
    console.info(`Client joined remote communication channel`);

    ws.on('message', (msg) => {
      try {
        msg = JSON.parse(msg);
      } catch (e) {
        console.error('Invalid JSON');
        return;
      }

      em.emit('message', msg);
      console.info(`Client sent message: ${JSON.stringify(msg)}`);
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
  app.listen(port, host, 511);
}

if (argv.openExternal) {
  const url = argv._[0];
  const { port } = argv;

  if (!url) {
    console.error("Please provide a URL");
    process.exit(1);
  }

  const webSocketUrl = `ws://localhost:${port}/terminals/remote-communication-channel/`;
  const ws = new WebSocket(webSocketUrl);
  console.info(webSocketUrl)
  ws.on('open', () => {
    const id = crypto.randomUUID();
    ws.send(JSON.stringify({ action: "openUrl", data: url, id }));
    console.info("Sent openUrl message");
    ws.close();
    process.exit(0);
  });
} else if (require.main === module) {
  startServer()
}

module.exports = startServer;
