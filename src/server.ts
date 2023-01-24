import crypto from "crypto";
import { IncomingMessage, createServer } from "http";
import internal from "stream";

const PORT = 1337;
const WEBSOCKET_MAGIC_STRING_KEY = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const SEVEN_BITS_INTEGER_MARKER = 125;
const SIXTEEN_BITS_INTEGER_MARKER = 126; // TODO: Practice doing this one
const MAXIMUM_SIXTEEN_BITS_INTEGER = 2 ** 16; // 0 to 65536

const SIXTYFOUR_BITS_INTEGER_MARKER = 127; // TODO: Practice doing this one

const MASK_KEY_BYTES_LENGTH = 4;
const OPCODE_TEXT = 0x01; // 1 bit in binary
// parseInt('10000000', 2);
const FIRST_BIT = 128;

const server = createServer((request, response) => {
  response.writeHead(200);
  response.end("Hey there!");
}).listen(PORT, () => console.log("Listening on port " + PORT));

server.on("upgrade", onSocketUpgrade);

function onSocketUpgrade(
  req: IncomingMessage,
  socket: internal.Duplex,
  head: Buffer
) {
  const { "sec-websocket-key": webClientSocketKey } = req.headers;

  console.log(`${webClientSocketKey} connected!`);

  const headers = prepareHandShakeHeaders(webClientSocketKey!);

  socket.write(headers);

  socket.on("readable", () => onSocketReadable(socket));
}

function sendMessage(msg: string, socket: internal.Duplex) {
  const data = prepareMessage(msg);

  socket.write(data);
}

function prepareMessage(message: string) {
  const msg = Buffer.from(message);
  const msgSize = msg.length;

  let dataFrameBuffer;

  // 0x80 = 128 in binary

  const firstByte = 0x80 | OPCODE_TEXT;

  if (msgSize <= SEVEN_BITS_INTEGER_MARKER) {
    const bytes = [firstByte];

    dataFrameBuffer = Buffer.from(bytes.concat(msgSize));
  } else if (msgSize <= MAXIMUM_SIXTEEN_BITS_INTEGER) {
    const offset = 4;

    const target = Buffer.allocUnsafe(offset);

    target[0] = firstByte;
    target[1] = SIXTEEN_BITS_INTEGER_MARKER | 0x0; // just to know the mask

    target.writeUInt16BE(msgSize, 2); // content length is 2 bytes

    dataFrameBuffer = target;
  } else {
    throw new Error("Message too large");
  }

  const totalLength = dataFrameBuffer.byteLength + msgSize;
  const dataFrameResponse = concat([dataFrameBuffer, msg], totalLength);

  return dataFrameResponse;
}

function concat(bufferList: any, totalLength: any) {
  const target = Buffer.allocUnsafe(totalLength);
  let offset = 0;

  for (const buffer of bufferList) {
    target.set(buffer, offset);

    offset += buffer.length;
  }

  return target;
}

function onSocketReadable(socket: internal.Duplex) {
  // CONSUME OPT CODE (FIRST BYTE)
  // 1 - 1 byte - 8 bits
  socket.read(1);

  const [markerAndPayloadLength] = socket.read(1);

  // Because the first bit is always 1 for client-to-server messages
  // you can subtract 1 bit (128 or 10000000) from this byte to get rid
  // of the mask bit
  const lengthIndicatorInBits = markerAndPayloadLength - FIRST_BIT;

  let messageLength = 0;

  if (lengthIndicatorInBits <= SEVEN_BITS_INTEGER_MARKER) {
    messageLength = lengthIndicatorInBits;
  } else if (lengthIndicatorInBits == SIXTEEN_BITS_INTEGER_MARKER) {
    // UNSIGNED BIG-ENDIAN 16-BIT INTEGER (0-65K) - 2 ** 16 [readUint16BE]
    messageLength = socket.read(2).readUint16BE(0);
  } else {
    throw new Error(
      "Your message is too long! We don't handle 64 bits messages"
    );
  }

  const maskKey = socket.read(MASK_KEY_BYTES_LENGTH);

  const encoded = socket.read(messageLength);
  const decoded = unmask(encoded, maskKey);

  const received = decoded.toString("utf8");

  const data = JSON.parse(received);

  console.log("Message received: " + received);

  const msg = JSON.stringify({
    message: data,
    at: new Date().toISOString(),
  });

  sendMessage(msg, socket);
}

function unmask(encodedBuffer: any, maskKey: any) {
  let finalBuffer = Buffer.from(encodedBuffer);

  // because the maskKey is only 4 bytes, we use the mod of index maskKey
  // index % 4 === 0, 1, 2, 3 = index bits needed to decode the message

  // XOR ^
  // returns 1 if both are different
  // return 0 if both are equal

  // (71).toString(2).padStart(8, "0") = 01000111
  // (53).toString(2).padStart(8, "0") = 00110101
  //                                     01110010 = XOR OF UPPER 2 BYTES

  // (71 ^ 53).toString(2).padStart(8, "0") = '01110010'
  // String.fromCharCode(parseInt('01110010', 2)) = 'r'

  const fillWithEightZeros = (t: any) => t.padStart(8, "0");
  const toBinary = (t: any) => fillWithEightZeros(t.toString(2));
  const fromBinaryToDecimal = (t: any) => parseInt(toBinary(t), 2);
  const getCharFromBinary = (t: any) =>
    String.fromCharCode(fromBinaryToDecimal(t));

  for (let i = 0; i < encodedBuffer.length; i++) {
    finalBuffer[i] = encodedBuffer[i] ^ maskKey[i % MASK_KEY_BYTES_LENGTH];

    const logger = {
      unmaskingChar: `${toBinary(encodedBuffer[i])} ^ ${toBinary(
        maskKey[i % MASK_KEY_BYTES_LENGTH]
      )} = ${toBinary(finalBuffer[i])}`,
      decoded: getCharFromBinary(finalBuffer[i]),
    };

    console.log(logger);
  }

  return finalBuffer;
}

function prepareHandShakeHeaders(id: string) {
  const validKey = createValidSocketKey(id);
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${validKey}`,
    "",
  ]
    .map((line) => line.concat("\r\n"))
    .join("");

  return headers;
}

function createValidSocketKey(id: string) {
  const shaOne = crypto.createHash("sha1");

  shaOne.update(id + WEBSOCKET_MAGIC_STRING_KEY);

  return shaOne.digest("base64");
}

// ERROR HANDLER TO KEEP SERVER ONLINE
["uncaughtException", "unhandledRejection"].forEach((event) =>
  process.on(event, (err) => {
    console.error(`Something bad happened! Event: ${event}`);
  })
);
