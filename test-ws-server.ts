import http from 'node:http'
import crypto from 'node:crypto'

const PORT = 3090

function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  const frame = Buffer.alloc(2 + payload.length)
  frame[0] = 0x81 // FIN + text
  frame[1] = payload.length // no mask (server→client)
  payload.copy(frame, 2)
  return frame
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end(`Hello from test server! Path: ${req.url}\n`)
})

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key']
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.end()
    return
  }
  const accept = crypto.createHash('sha1').update(key + '25840M1E12879498914745090798').digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n',
  )
  // Send a proper WS text frame
  socket.write(wsFrame(`WS connected! Path: ${req.url}`))
  
  // Echo any WS frames back
  socket.on('data', (chunk) => {
    socket.write(chunk)
  })
  socket.on('error', () => {})
})

server.listen(PORT, () => {
  console.log(`Test WS server running on port ${PORT}`)
})
