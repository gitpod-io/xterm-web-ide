const express = require('express');
const expressWs = require('express-ws');
const os = require('os');
const pty = require('node-pty');

function startServer() {
  const app = express();
  expressWs(app);

  var terminals = {},
      logs = {};

  app.use('/styles.css', express.static(__dirname + '/assets/styles.css'));
  app.get('/logo.png', (req, res) => { // lgtm [js/missing-rate-limiting]
    res.sendFile(__dirname + '/logo.png');
  });

  app.get('/', (req, res) => { // lgtm [js/missing-rate-limiting]
    res.sendFile(__dirname + '/index.html');
  });

  app.get('/style.css', (req, res) => { // lgtm [js/missing-rate-limiting]
    res.sendFile(__dirname + '/style.css');
  });

  app.use('/dist', express.static(__dirname + '/dist'));

  app.post('/terminals', (req, res) => {
    const env = Object.assign({}, process.env);
    env['COLORTERM'] = 'truecolor';
    const cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: env.GITPOD_REPO_ROOT || env.PWD,
        env: env,
        encoding: null
      });

    console.log(`Created terminal with PID: ${term.pid}`);
    terminals[term.pid] = term;
    logs[term.pid] = '';
    term.on('data', function(data) {
      logs[term.pid] += data;
    });
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

  app.ws('/terminals/:pid', function (ws, req) {
    var term = terminals[parseInt(req.params.pid)];
    console.log(`Connected to terminal ${term.pid}`);
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
    term.on('data', function(data) {
      try {
        send(data);
      } catch (ex) {
        // The WebSocket is not open, ignore
      }
    });
    ws.on('message', function(msg) {
      term.write(msg);
    });
    ws.on('close', function () {
      /*
      term.kill();
      console.log('Closed terminal ' + term.pid);
      // Clean things up
      delete terminals[term.pid];
      delete logs[term.pid];
      */
    });
  });

  const port = process.env.PORT || 23000,
      host = os.platform() === 'win32' ? '127.0.0.1' : '0.0.0.0';

  console.log('App listening to http://127.0.0.1:' + port);
  app.listen(port, host);
}

if (require.main === module) {
  startServer()
}

module.exports = startServer;
