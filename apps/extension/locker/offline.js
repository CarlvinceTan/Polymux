var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// apps/extension/scripts/crypto-shim.js
var crypto_shim_exports = {};
__export(crypto_shim_exports, {
  default: () => crypto_shim_default,
  randomBytes: () => randomBytes,
  webcrypto: () => webcrypto
});
function randomBytes(size) {
  const bytes = new Uint8Array(size);
  web.getRandomValues(bytes);
  return bytes;
}
var web, webcrypto, crypto_shim_default;
var init_crypto_shim = __esm({
  "apps/extension/scripts/crypto-shim.js"() {
    web = globalThis.crypto;
    webcrypto = web;
    crypto_shim_default = web;
  }
});

// apps/extension/scripts/dom-shim.js
var dom_shim_exports = {};
__export(dom_shim_exports, {
  DOMParser: () => DOMParser,
  XMLSerializer: () => XMLSerializer
});
var DOMParser, XMLSerializer;
var init_dom_shim = __esm({
  "apps/extension/scripts/dom-shim.js"() {
    DOMParser = class {
      parseFromString(text, type) {
        return new globalThis.DOMParser().parseFromString(text, type);
      }
    };
    XMLSerializer = class {
      serializeToString(node) {
        return new globalThis.XMLSerializer().serializeToString(node);
      }
    };
  }
});

// node_modules/kdbxweb/dist/kdbxweb.js
var require_kdbxweb = __commonJS({
  "node_modules/kdbxweb/dist/kdbxweb.js"(exports, module) {
    (function webpackUniversalModuleDefinition(root, factory) {
      if (typeof exports === "object" && typeof module === "object")
        module.exports = factory((init_crypto_shim(), __toCommonJS(crypto_shim_exports)), (init_dom_shim(), __toCommonJS(dom_shim_exports)));
      else if (typeof define === "function" && define.amd)
        define(["crypto", "@xmldom/xmldom"], factory);
      else if (typeof exports === "object")
        exports["kdbxweb"] = factory((init_crypto_shim(), __toCommonJS(crypto_shim_exports)), (init_dom_shim(), __toCommonJS(dom_shim_exports)));
      else
        root["kdbxweb"] = factory(root["crypto"], root["@xmldom/xmldom"]);
    })(exports, function(__WEBPACK_EXTERNAL_MODULE_crypto__, __WEBPACK_EXTERNAL_MODULE__xmldom_xmldom__) {
      return (
        /******/
        (() => {
          "use strict";
          var __webpack_modules__ = {
            /***/
            "./crypto/chacha20.ts": (
              /*!****************************!*\
                !*** ./crypto/chacha20.ts ***!
                \****************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.ChaCha20 = void 0;
                class ChaCha20 {
                  constructor(key, nonce) {
                    this._sigmaWords = [1634760805, 857760878, 2036477234, 1797285236];
                    this._block = new Uint8Array(64);
                    this._blockUsed = 64;
                    this._x = new Uint32Array(16);
                    const input = new Uint32Array(16);
                    input[0] = this._sigmaWords[0];
                    input[1] = this._sigmaWords[1];
                    input[2] = this._sigmaWords[2];
                    input[3] = this._sigmaWords[3];
                    input[4] = u8to32le(key, 0);
                    input[5] = u8to32le(key, 4);
                    input[6] = u8to32le(key, 8);
                    input[7] = u8to32le(key, 12);
                    input[8] = u8to32le(key, 16);
                    input[9] = u8to32le(key, 20);
                    input[10] = u8to32le(key, 24);
                    input[11] = u8to32le(key, 28);
                    input[12] = 0;
                    if (nonce.length === 12) {
                      input[13] = u8to32le(nonce, 0);
                      input[14] = u8to32le(nonce, 4);
                      input[15] = u8to32le(nonce, 8);
                    } else {
                      input[13] = 0;
                      input[14] = u8to32le(nonce, 0);
                      input[15] = u8to32le(nonce, 4);
                    }
                    this._input = input;
                  }
                  getBytes(numberOfBytes) {
                    const out = new Uint8Array(numberOfBytes);
                    for (let i = 0; i < numberOfBytes; i++) {
                      if (this._blockUsed === 64) {
                        this.generateBlock();
                        this._blockUsed = 0;
                      }
                      out[i] = this._block[this._blockUsed];
                      this._blockUsed++;
                    }
                    return out;
                  }
                  generateBlock() {
                    const input = this._input;
                    const x = this._x;
                    const block2 = this._block;
                    x.set(input);
                    for (let i = 20; i > 0; i -= 2) {
                      quarterRound(x, 0, 4, 8, 12);
                      quarterRound(x, 1, 5, 9, 13);
                      quarterRound(x, 2, 6, 10, 14);
                      quarterRound(x, 3, 7, 11, 15);
                      quarterRound(x, 0, 5, 10, 15);
                      quarterRound(x, 1, 6, 11, 12);
                      quarterRound(x, 2, 7, 8, 13);
                      quarterRound(x, 3, 4, 9, 14);
                    }
                    for (let i = 16; i--; ) {
                      x[i] += input[i];
                    }
                    for (let i = 16; i--; ) {
                      u32to8le(block2, 4 * i, x[i]);
                    }
                    input[12] += 1;
                    if (!input[12]) {
                      input[13] += 1;
                    }
                  }
                  encrypt(data) {
                    const length = data.length;
                    const res = new Uint8Array(length);
                    let pos = 0;
                    const block2 = this._block;
                    while (pos < length) {
                      this.generateBlock();
                      const blockLength = Math.min(length - pos, 64);
                      for (let i = 0; i < blockLength; i++) {
                        res[pos] = data[pos] ^ block2[i];
                        pos++;
                      }
                    }
                    return res;
                  }
                }
                exports2.ChaCha20 = ChaCha20;
                function quarterRound(x, a, b, c, d) {
                  x[a] += x[b];
                  x[d] = rotate(x[d] ^ x[a], 16);
                  x[c] += x[d];
                  x[b] = rotate(x[b] ^ x[c], 12);
                  x[a] += x[b];
                  x[d] = rotate(x[d] ^ x[a], 8);
                  x[c] += x[d];
                  x[b] = rotate(x[b] ^ x[c], 7);
                }
                function u8to32le(x, i) {
                  return x[i] | x[i + 1] << 8 | x[i + 2] << 16 | x[i + 3] << 24;
                }
                function u32to8le(x, i, u) {
                  x[i] = u;
                  u >>>= 8;
                  x[i + 1] = u;
                  u >>>= 8;
                  x[i + 2] = u;
                  u >>>= 8;
                  x[i + 3] = u;
                }
                function rotate(v, c) {
                  return v << c | v >>> 32 - c;
                }
              })
            ),
            /***/
            "./crypto/crypto-engine.ts": (
              /*!*********************************!*\
                !*** ./crypto/crypto-engine.ts ***!
                \*********************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.setArgon2Impl = exports2.argon2 = exports2.Argon2TypeArgon2id = exports2.Argon2TypeArgon2d = exports2.chacha20 = exports2.random = exports2.createAesCbc = exports2.AesCbc = exports2.hmacSha256 = exports2.sha512 = exports2.sha256 = void 0;
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const chacha20_1 = __webpack_require__2(
                  /*! ./chacha20 */
                  "./crypto/chacha20.ts"
                );
                const nodeCrypto = __webpack_require__2(
                  /*! crypto */
                  "crypto"
                );
                const EmptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
                const EmptySha512 = "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e";
                const MaxRandomQuota = 65536;
                function sha2562(data) {
                  var _a;
                  if (!data.byteLength) {
                    return Promise.resolve((0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.hexToBytes)(EmptySha256)));
                  }
                  if ((_a = __webpack_require__2.g.crypto) === null || _a === void 0 ? void 0 : _a.subtle) {
                    return __webpack_require__2.g.crypto.subtle.digest({ name: "SHA-256" }, data);
                  } else {
                    return new Promise((resolve) => {
                      const sha = nodeCrypto.createHash("sha256");
                      const hash = sha.update(Buffer.from(data)).digest();
                      resolve(hash.buffer);
                    });
                  }
                }
                exports2.sha256 = sha2562;
                function sha5122(data) {
                  var _a;
                  if (!data.byteLength) {
                    return Promise.resolve((0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.hexToBytes)(EmptySha512)));
                  }
                  if ((_a = __webpack_require__2.g.crypto) === null || _a === void 0 ? void 0 : _a.subtle) {
                    return __webpack_require__2.g.crypto.subtle.digest({ name: "SHA-512" }, data);
                  } else {
                    return new Promise((resolve) => {
                      const sha = nodeCrypto.createHash("sha512");
                      const hash = sha.update(Buffer.from(data)).digest();
                      resolve(hash.buffer);
                    });
                  }
                }
                exports2.sha512 = sha5122;
                function hmacSha256(key, data) {
                  var _a;
                  if ((_a = __webpack_require__2.g.crypto) === null || _a === void 0 ? void 0 : _a.subtle) {
                    const algo = { name: "HMAC", hash: { name: "SHA-256" } };
                    return __webpack_require__2.g.crypto.subtle.importKey("raw", key, algo, false, ["sign"]).then((subtleKey) => {
                      return __webpack_require__2.g.crypto.subtle.sign(algo, subtleKey, data);
                    });
                  } else {
                    return new Promise((resolve) => {
                      const hmac2 = nodeCrypto.createHmac("sha256", Buffer.from(key));
                      const hash = hmac2.update(Buffer.from(data)).digest();
                      resolve(hash.buffer);
                    });
                  }
                }
                exports2.hmacSha256 = hmacSha256;
                class AesCbc {
                }
                exports2.AesCbc = AesCbc;
                class AesCbcSubtle extends AesCbc {
                  get key() {
                    if (!this._key) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no key");
                    }
                    return this._key;
                  }
                  importKey(key) {
                    return __webpack_require__2.g.crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]).then((key2) => {
                      this._key = key2;
                    });
                  }
                  encrypt(data, iv) {
                    return __webpack_require__2.g.crypto.subtle.encrypt({ name: "AES-CBC", iv }, this.key, data);
                  }
                  decrypt(data, iv) {
                    return __webpack_require__2.g.crypto.subtle.decrypt({ name: "AES-CBC", iv }, this.key, data).catch(() => {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidKey, "invalid key");
                    });
                  }
                }
                class AesCbcNode extends AesCbc {
                  get key() {
                    if (!this._key) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no key");
                    }
                    return this._key;
                  }
                  importKey(key) {
                    this._key = key;
                    return Promise.resolve();
                  }
                  encrypt(data, iv) {
                    return Promise.resolve().then(() => {
                      const cipher = nodeCrypto.createCipheriv("aes-256-cbc", Buffer.from(this.key), Buffer.from(iv));
                      const block2 = cipher.update(Buffer.from(data));
                      return (0, byte_utils_1.arrayToBuffer)(Buffer.concat([block2, cipher.final()]));
                    });
                  }
                  decrypt(data, iv) {
                    return Promise.resolve().then(() => {
                      const cipher = nodeCrypto.createDecipheriv("aes-256-cbc", Buffer.from(this.key), Buffer.from(iv));
                      const block2 = cipher.update(Buffer.from(data));
                      return (0, byte_utils_1.arrayToBuffer)(Buffer.concat([block2, cipher.final()]));
                    }).catch(() => {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidKey, "invalid key");
                    });
                  }
                }
                function createAesCbc() {
                  var _a;
                  if ((_a = __webpack_require__2.g.crypto) === null || _a === void 0 ? void 0 : _a.subtle) {
                    return new AesCbcSubtle();
                  } else {
                    return new AesCbcNode();
                  }
                }
                exports2.createAesCbc = createAesCbc;
                function safeRandomWeb(len) {
                  const randomBytes3 = new Uint8Array(len);
                  while (len > 0) {
                    let segmentSize = len % MaxRandomQuota;
                    segmentSize = segmentSize > 0 ? segmentSize : MaxRandomQuota;
                    const randomBytesSegment = new Uint8Array(segmentSize);
                    __webpack_require__2.g.crypto.getRandomValues(randomBytesSegment);
                    len -= segmentSize;
                    randomBytes3.set(randomBytesSegment, len);
                  }
                  return randomBytes3;
                }
                function random(len) {
                  var _a;
                  if ((_a = __webpack_require__2.g.crypto) === null || _a === void 0 ? void 0 : _a.subtle) {
                    return safeRandomWeb(len);
                  } else {
                    return new Uint8Array(nodeCrypto.randomBytes(len));
                  }
                }
                exports2.random = random;
                function chacha20(data, key, iv) {
                  return Promise.resolve().then(() => {
                    const algo = new chacha20_1.ChaCha20(new Uint8Array(key), new Uint8Array(iv));
                    return (0, byte_utils_1.arrayToBuffer)(algo.encrypt(new Uint8Array(data)));
                  });
                }
                exports2.chacha20 = chacha20;
                exports2.Argon2TypeArgon2d = 0;
                exports2.Argon2TypeArgon2id = 2;
                let argon2impl;
                function argon22(password, salt, memory, iterations, length, parallelism, type, version) {
                  if (argon2impl) {
                    return argon2impl(password, salt, memory, iterations, length, parallelism, type, version).then(byte_utils_1.arrayToBuffer);
                  }
                  return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.NotImplemented, "argon2 not implemented"));
                }
                exports2.argon2 = argon22;
                function setArgon2Impl(impl) {
                  argon2impl = impl;
                }
                exports2.setArgon2Impl = setArgon2Impl;
              })
            ),
            /***/
            "./crypto/hashed-block-transform.ts": (
              /*!******************************************!*\
                !*** ./crypto/hashed-block-transform.ts ***!
                \******************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.encrypt = exports2.decrypt = void 0;
                const binary_stream_1 = __webpack_require__2(
                  /*! ../utils/binary-stream */
                  "./utils/binary-stream.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const BlockSize = 1024 * 1024;
                function decrypt(data) {
                  return Promise.resolve().then(() => {
                    const stm = new binary_stream_1.BinaryStream(data);
                    const buffers = [];
                    let blockLength = 0, blockHash, totalLength = 0;
                    const next = () => {
                      stm.getUint32(true);
                      blockHash = stm.readBytes(32);
                      blockLength = stm.getUint32(true);
                      if (blockLength > 0) {
                        totalLength += blockLength;
                        const blockData = stm.readBytes(blockLength);
                        return CryptoEngine.sha256(blockData).then((calculatedHash) => {
                          if (!(0, byte_utils_1.arrayBufferEquals)(calculatedHash, blockHash)) {
                            throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "invalid hash block");
                          } else {
                            buffers.push(blockData);
                            return next();
                          }
                        });
                      } else {
                        const ret = new Uint8Array(totalLength);
                        let offset = 0;
                        for (let i = 0; i < buffers.length; i++) {
                          ret.set(new Uint8Array(buffers[i]), offset);
                          offset += buffers[i].byteLength;
                        }
                        return Promise.resolve(ret.buffer);
                      }
                    };
                    return next();
                  });
                }
                exports2.decrypt = decrypt;
                function encrypt(data) {
                  return Promise.resolve().then(() => {
                    let bytesLeft = data.byteLength;
                    let currentOffset = 0, blockIndex = 0, totalLength = 0;
                    const buffers = [];
                    const next = () => {
                      if (bytesLeft > 0) {
                        const blockLength = Math.min(BlockSize, bytesLeft);
                        bytesLeft -= blockLength;
                        const blockData = data.slice(currentOffset, currentOffset + blockLength);
                        return CryptoEngine.sha256(blockData).then((blockHash) => {
                          const blockBuffer = new ArrayBuffer(4 + 32 + 4);
                          const stm = new binary_stream_1.BinaryStream(blockBuffer);
                          stm.setUint32(blockIndex, true);
                          stm.writeBytes(blockHash);
                          stm.setUint32(blockLength, true);
                          buffers.push(blockBuffer);
                          totalLength += blockBuffer.byteLength;
                          buffers.push(blockData);
                          totalLength += blockData.byteLength;
                          blockIndex++;
                          currentOffset += blockLength;
                          return next();
                        });
                      } else {
                        const endBlockData = new ArrayBuffer(4 + 32 + 4);
                        const view = new DataView(endBlockData);
                        view.setUint32(0, blockIndex, true);
                        buffers.push(endBlockData);
                        totalLength += endBlockData.byteLength;
                        const ret = new Uint8Array(totalLength);
                        let offset = 0;
                        for (let i = 0; i < buffers.length; i++) {
                          ret.set(new Uint8Array(buffers[i]), offset);
                          offset += buffers[i].byteLength;
                        }
                        return Promise.resolve(ret.buffer);
                      }
                    };
                    return next();
                  });
                }
                exports2.encrypt = encrypt;
              })
            ),
            /***/
            "./crypto/hmac-block-transform.ts": (
              /*!****************************************!*\
                !*** ./crypto/hmac-block-transform.ts ***!
                \****************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.encrypt = exports2.decrypt = exports2.getHmacKey = void 0;
                const int64_1 = __webpack_require__2(
                  /*! ../utils/int64 */
                  "./utils/int64.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const binary_stream_1 = __webpack_require__2(
                  /*! ../utils/binary-stream */
                  "./utils/binary-stream.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const BlockSize = 1024 * 1024;
                function getHmacKey(key, blockIndex) {
                  const shaSrc = new Uint8Array(8 + key.byteLength);
                  shaSrc.set(new Uint8Array(key), 8);
                  const view = new DataView(shaSrc.buffer);
                  view.setUint32(0, blockIndex.lo, true);
                  view.setUint32(4, blockIndex.hi, true);
                  return CryptoEngine.sha512((0, byte_utils_1.arrayToBuffer)(shaSrc)).then((sha) => {
                    (0, byte_utils_1.zeroBuffer)(shaSrc);
                    return sha;
                  });
                }
                exports2.getHmacKey = getHmacKey;
                function getBlockHmac(key, blockIndex, blockLength, blockData) {
                  return getHmacKey(key, new int64_1.Int64(blockIndex)).then((blockKey) => {
                    const blockDataForHash = new Uint8Array(blockData.byteLength + 4 + 8);
                    const blockDataForHashView = new DataView(blockDataForHash.buffer);
                    blockDataForHash.set(new Uint8Array(blockData), 4 + 8);
                    blockDataForHashView.setInt32(0, blockIndex, true);
                    blockDataForHashView.setInt32(8, blockLength, true);
                    return CryptoEngine.hmacSha256(blockKey, blockDataForHash.buffer);
                  });
                }
                function decrypt(data, key) {
                  const stm = new binary_stream_1.BinaryStream(data);
                  return Promise.resolve().then(() => {
                    const buffers = [];
                    let blockIndex = 0, blockLength = 0, blockHash, totalLength = 0;
                    const next = () => {
                      blockHash = stm.readBytes(32);
                      blockLength = stm.getUint32(true);
                      if (blockLength > 0) {
                        totalLength += blockLength;
                        const blockData = stm.readBytes(blockLength);
                        return getBlockHmac(key, blockIndex, blockLength, blockData).then((calculatedBlockHash) => {
                          if (!(0, byte_utils_1.arrayBufferEquals)(calculatedBlockHash, blockHash)) {
                            throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "invalid hash block");
                          } else {
                            buffers.push(blockData);
                            blockIndex++;
                            return next();
                          }
                        });
                      } else {
                        const ret = new Uint8Array(totalLength);
                        let offset = 0;
                        for (let i = 0; i < buffers.length; i++) {
                          ret.set(new Uint8Array(buffers[i]), offset);
                          offset += buffers[i].byteLength;
                        }
                        return Promise.resolve(ret.buffer);
                      }
                    };
                    return next();
                  });
                }
                exports2.decrypt = decrypt;
                function encrypt(data, key) {
                  return Promise.resolve().then(() => {
                    let bytesLeft = data.byteLength;
                    let currentOffset = 0, blockIndex = 0, totalLength = 0;
                    const buffers = [];
                    const next = () => {
                      const blockLength = Math.min(BlockSize, bytesLeft);
                      bytesLeft -= blockLength;
                      const blockData = data.slice(currentOffset, currentOffset + blockLength);
                      return getBlockHmac(key, blockIndex, blockLength, blockData).then((blockHash) => {
                        const blockBuffer = new ArrayBuffer(32 + 4);
                        const stm = new binary_stream_1.BinaryStream(blockBuffer);
                        stm.writeBytes(blockHash);
                        stm.setUint32(blockLength, true);
                        buffers.push(blockBuffer);
                        totalLength += blockBuffer.byteLength;
                        if (blockData.byteLength > 0) {
                          buffers.push(blockData);
                          totalLength += blockData.byteLength;
                          blockIndex++;
                          currentOffset += blockLength;
                          return next();
                        } else {
                          const ret = new Uint8Array(totalLength);
                          let offset = 0;
                          for (let i = 0; i < buffers.length; i++) {
                            ret.set(new Uint8Array(buffers[i]), offset);
                            offset += buffers[i].byteLength;
                          }
                          return ret.buffer;
                        }
                      });
                    };
                    return next();
                  });
                }
                exports2.encrypt = encrypt;
              })
            ),
            /***/
            "./crypto/key-encryptor-aes.ts": (
              /*!*************************************!*\
                !*** ./crypto/key-encryptor-aes.ts ***!
                \*************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.encrypt = void 0;
                const CryptoEngine = __webpack_require__2(
                  /*! ./crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const maxRoundsPreIteration = 1e4;
                const aesBlockSize = 16;
                const credentialSize = 32;
                function encrypt(credentials, key, rounds) {
                  const algo = CryptoEngine.createAesCbc();
                  return algo.importKey((0, byte_utils_1.arrayToBuffer)(key)).then(() => {
                    const resolvers = [];
                    for (let idx = 0; idx < credentialSize; idx += aesBlockSize) {
                      resolvers.push(encryptBlock(algo, credentials.subarray(idx, idx + aesBlockSize), rounds));
                    }
                    return Promise.all(resolvers);
                  }).then((results) => {
                    const res = new Uint8Array(credentialSize);
                    results.forEach((result, idx) => {
                      const base = idx * aesBlockSize;
                      for (let i = 0; i < aesBlockSize; ++i) {
                        res[i + base] = result[i];
                      }
                      (0, byte_utils_1.zeroBuffer)(result);
                    });
                    return res;
                  });
                }
                exports2.encrypt = encrypt;
                function encryptBlock(algo, iv, rounds) {
                  let result = Promise.resolve((0, byte_utils_1.arrayToBuffer)(iv));
                  const buffer = new Uint8Array(aesBlockSize * Math.min(rounds, maxRoundsPreIteration));
                  while (rounds > 0) {
                    const currentRounds = Math.min(rounds, maxRoundsPreIteration);
                    rounds -= currentRounds;
                    const dataLen = aesBlockSize * currentRounds;
                    const zeroData = buffer.length === dataLen ? buffer.buffer : (0, byte_utils_1.arrayToBuffer)(buffer.subarray(0, dataLen));
                    result = encryptBlockBuffer(algo, result, zeroData);
                  }
                  return result.then((res) => {
                    return new Uint8Array(res);
                  });
                }
                function encryptBlockBuffer(algo, promisedIv, buffer) {
                  return promisedIv.then((iv) => {
                    return algo.encrypt(buffer, iv);
                  }).then((buf) => {
                    const res = (0, byte_utils_1.arrayToBuffer)(new Uint8Array(buf).subarray(-2 * aesBlockSize, -aesBlockSize));
                    (0, byte_utils_1.zeroBuffer)(buf);
                    return res;
                  });
                }
              })
            ),
            /***/
            "./crypto/key-encryptor-kdf.ts": (
              /*!*************************************!*\
                !*** ./crypto/key-encryptor-kdf.ts ***!
                \*************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.encrypt = void 0;
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const KeyEncryptorAes = __webpack_require__2(
                  /*! ./key-encryptor-aes */
                  "./crypto/key-encryptor-aes.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const int64_1 = __webpack_require__2(
                  /*! ../utils/int64 */
                  "./utils/int64.ts"
                );
                function encrypt(key, kdfParams) {
                  const uuid = kdfParams.get("$UUID");
                  if (!uuid || !(uuid instanceof ArrayBuffer)) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no kdf uuid"));
                  }
                  const kdfUuid = (0, byte_utils_1.bytesToBase64)(uuid);
                  switch (kdfUuid) {
                    case consts_1.KdfId.Argon2d:
                      return encryptArgon2(key, kdfParams, CryptoEngine.Argon2TypeArgon2d);
                    case consts_1.KdfId.Argon2id:
                      return encryptArgon2(key, kdfParams, CryptoEngine.Argon2TypeArgon2id);
                    case consts_1.KdfId.Aes:
                      return encryptAes(key, kdfParams);
                    default:
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "bad kdf"));
                  }
                }
                exports2.encrypt = encrypt;
                function encryptArgon2(key, kdfParams, argon2type) {
                  const salt = kdfParams.get("S");
                  if (!(salt instanceof ArrayBuffer) || salt.byteLength !== 32) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad argon2 salt"));
                  }
                  const parallelism = toNumber(kdfParams.get("P"));
                  if (typeof parallelism !== "number" || parallelism < 1) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad argon2 parallelism"));
                  }
                  const iterations = toNumber(kdfParams.get("I"));
                  if (typeof iterations !== "number" || iterations < 1) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad argon2 iterations"));
                  }
                  const memory = toNumber(kdfParams.get("M"));
                  if (typeof memory !== "number" || memory < 1 || memory % 1024 !== 0) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad argon2 memory"));
                  }
                  const version = kdfParams.get("V");
                  if (version !== 19 && version !== 16) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad argon2 version"));
                  }
                  const secretKey = kdfParams.get("K");
                  if (secretKey) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "argon2 secret key"));
                  }
                  const assocData = kdfParams.get("A");
                  if (assocData) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "argon2 assoc data"));
                  }
                  return CryptoEngine.argon2(key, salt, memory / 1024, iterations, 32, parallelism, argon2type, version);
                }
                function encryptAes(key, kdfParams) {
                  const salt = kdfParams.get("S");
                  if (!(salt instanceof ArrayBuffer) || salt.byteLength !== 32) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad aes salt"));
                  }
                  const rounds = toNumber(kdfParams.get("R"));
                  if (typeof rounds !== "number" || rounds < 1) {
                    return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad aes rounds"));
                  }
                  return KeyEncryptorAes.encrypt(new Uint8Array(key), new Uint8Array(salt), rounds).then((key2) => {
                    return CryptoEngine.sha256(key2).then((hash) => {
                      (0, byte_utils_1.zeroBuffer)(key2);
                      return hash;
                    });
                  });
                }
                function toNumber(number) {
                  if (typeof number === "number") {
                    return number;
                  } else if (number instanceof int64_1.Int64) {
                    return number.value;
                  }
                  return void 0;
                }
              })
            ),
            /***/
            "./crypto/protect-salt-generator.ts": (
              /*!******************************************!*\
                !*** ./crypto/protect-salt-generator.ts ***!
                \******************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.ProtectSaltGenerator = void 0;
                const salsa20_1 = __webpack_require__2(
                  /*! ./salsa20 */
                  "./crypto/salsa20.ts"
                );
                const chacha20_1 = __webpack_require__2(
                  /*! ./chacha20 */
                  "./crypto/chacha20.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const SalsaNonce = new Uint8Array([232, 48, 9, 75, 151, 32, 93, 42]);
                class ProtectSaltGenerator {
                  constructor(algo) {
                    this._algo = algo;
                  }
                  getSalt(len) {
                    return (0, byte_utils_1.arrayToBuffer)(this._algo.getBytes(len));
                  }
                  static create(key, crsAlgorithm) {
                    switch (crsAlgorithm) {
                      case consts_1.CrsAlgorithm.Salsa20:
                        return CryptoEngine.sha256((0, byte_utils_1.arrayToBuffer)(key)).then((hash) => {
                          const key2 = new Uint8Array(hash);
                          const algo = new salsa20_1.Salsa20(key2, SalsaNonce);
                          return new ProtectSaltGenerator(algo);
                        });
                      case consts_1.CrsAlgorithm.ChaCha20:
                        return CryptoEngine.sha512((0, byte_utils_1.arrayToBuffer)(key)).then((hash) => {
                          const key2 = new Uint8Array(hash, 0, 32);
                          const nonce = new Uint8Array(hash, 32, 12);
                          const algo = new chacha20_1.ChaCha20(key2, nonce);
                          return new ProtectSaltGenerator(algo);
                        });
                      default:
                        return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "crsAlgorithm"));
                    }
                  }
                }
                exports2.ProtectSaltGenerator = ProtectSaltGenerator;
              })
            ),
            /***/
            "./crypto/protected-value.ts": (
              /*!***********************************!*\
                !*** ./crypto/protected-value.ts ***!
                \***********************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.ProtectedValue = void 0;
                const CryptoEngine = __webpack_require__2(
                  /*! ./crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                class ProtectedValue {
                  constructor(value, salt) {
                    this.value = new Uint8Array(value);
                    this.salt = new Uint8Array(salt);
                  }
                  toString() {
                    return (0, byte_utils_1.bytesToBase64)(this.value);
                  }
                  static fromString(str) {
                    const bytes = (0, byte_utils_1.stringToBytes)(str), salt = CryptoEngine.random(bytes.length);
                    for (let i = 0, len = bytes.length; i < len; i++) {
                      bytes[i] ^= salt[i];
                    }
                    return new ProtectedValue((0, byte_utils_1.arrayToBuffer)(bytes), (0, byte_utils_1.arrayToBuffer)(salt));
                  }
                  toBase64() {
                    const binary = this.getBinary();
                    const base64 = (0, byte_utils_1.bytesToBase64)(binary);
                    (0, byte_utils_1.zeroBuffer)(binary);
                    return base64;
                  }
                  static fromBase64(base64) {
                    const bytes = (0, byte_utils_1.base64ToBytes)(base64);
                    return ProtectedValue.fromBinary(bytes);
                  }
                  /**
                   * Keep in mind that you're passing the ownership of this array, the contents will be destroyed
                   */
                  static fromBinary(binary) {
                    const bytes = new Uint8Array(binary), salt = CryptoEngine.random(bytes.length);
                    for (let i = 0, len = bytes.length; i < len; i++) {
                      bytes[i] ^= salt[i];
                    }
                    return new ProtectedValue((0, byte_utils_1.arrayToBuffer)(bytes), (0, byte_utils_1.arrayToBuffer)(salt));
                  }
                  includes(str) {
                    if (str.length === 0) {
                      return false;
                    }
                    const source = this.value, salt = this.salt, search = (0, byte_utils_1.stringToBytes)(str), sourceLen = source.length, searchLen = search.length, maxPos = sourceLen - searchLen;
                    src: for (let sourceIx = 0; sourceIx <= maxPos; sourceIx++) {
                      for (let searchIx = 0; searchIx < searchLen; searchIx++) {
                        if ((source[sourceIx + searchIx] ^ salt[sourceIx + searchIx]) !== search[searchIx]) {
                          continue src;
                        }
                      }
                      return true;
                    }
                    return false;
                  }
                  getHash() {
                    const binary = (0, byte_utils_1.arrayToBuffer)(this.getBinary());
                    return CryptoEngine.sha256(binary).then((hash) => {
                      (0, byte_utils_1.zeroBuffer)(binary);
                      return hash;
                    });
                  }
                  getText() {
                    return (0, byte_utils_1.bytesToString)(this.getBinary());
                  }
                  getBinary() {
                    const value = this.value, salt = this.salt;
                    const bytes = new Uint8Array(value.byteLength);
                    for (let i = bytes.length - 1; i >= 0; i--) {
                      bytes[i] = value[i] ^ salt[i];
                    }
                    return bytes;
                  }
                  setSalt(newSalt) {
                    const newSaltArr = new Uint8Array(newSalt);
                    const value = this.value, salt = this.salt;
                    for (let i = 0, len = value.length; i < len; i++) {
                      value[i] = value[i] ^ salt[i] ^ newSaltArr[i];
                      salt[i] = newSaltArr[i];
                    }
                  }
                  clone() {
                    return new ProtectedValue(this.value, this.salt);
                  }
                  get byteLength() {
                    return this.value.byteLength;
                  }
                }
                exports2.ProtectedValue = ProtectedValue;
              })
            ),
            /***/
            "./crypto/salsa20.ts": (
              /*!***************************!*\
                !*** ./crypto/salsa20.ts ***!
                \***************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.Salsa20 = void 0;
                class Salsa20 {
                  constructor(key, nonce) {
                    this._rounds = 20;
                    this._sigmaWords = [1634760805, 857760878, 2036477234, 1797285236];
                    this._keyWords = [];
                    this._nonceWords = [0, 0];
                    this._counterWords = [0, 0];
                    this._block = new Uint8Array(64);
                    this._blockUsed = 64;
                    this.setKey(key);
                    this.setNonce(nonce);
                  }
                  // setKey sets the key to the given 32-byte array.
                  setKey(key) {
                    for (let i = 0, j = 0; i < 8; i++, j += 4) {
                      this._keyWords[i] = key[j] & 255 | (key[j + 1] & 255) << 8 | (key[j + 2] & 255) << 16 | (key[j + 3] & 255) << 24;
                    }
                    this.reset();
                  }
                  // setNonce sets the nonce to the given 8-byte array.
                  setNonce(nonce) {
                    this._nonceWords[0] = nonce[0] & 255 | (nonce[1] & 255) << 8 | (nonce[2] & 255) << 16 | (nonce[3] & 255) << 24;
                    this._nonceWords[1] = nonce[4] & 255 | (nonce[5] & 255) << 8 | (nonce[6] & 255) << 16 | (nonce[7] & 255) << 24;
                    this.reset();
                  }
                  // getBytes returns the next numberOfBytes bytes of stream.
                  getBytes(numberOfBytes) {
                    const out = new Uint8Array(numberOfBytes);
                    for (let i = 0; i < numberOfBytes; i++) {
                      if (this._blockUsed === 64) {
                        this.generateBlock();
                        this.incrementCounter();
                        this._blockUsed = 0;
                      }
                      out[i] = this._block[this._blockUsed];
                      this._blockUsed++;
                    }
                    return out;
                  }
                  getHexString(numberOfBytes) {
                    const hex = [
                      "0",
                      "1",
                      "2",
                      "3",
                      "4",
                      "5",
                      "6",
                      "7",
                      "8",
                      "9",
                      "a",
                      "b",
                      "c",
                      "d",
                      "e",
                      "f"
                    ];
                    const out = [];
                    const bytes = this.getBytes(numberOfBytes);
                    for (let i = 0; i < bytes.length; i++) {
                      out.push(hex[bytes[i] >> 4 & 15]);
                      out.push(hex[bytes[i] & 15]);
                    }
                    return out.join("");
                  }
                  reset() {
                    this._counterWords[0] = 0;
                    this._counterWords[1] = 0;
                    this._blockUsed = 64;
                  }
                  incrementCounter() {
                    this._counterWords[0] = this._counterWords[0] + 1 & 4294967295;
                    if (this._counterWords[0] === 0) {
                      this._counterWords[1] = this._counterWords[1] + 1 & 4294967295;
                    }
                  }
                  // _generateBlock generates 64 bytes from key, nonce, and counter,
                  // and puts the result into this.block.
                  generateBlock() {
                    const j0 = this._sigmaWords[0], j1 = this._keyWords[0], j2 = this._keyWords[1], j3 = this._keyWords[2], j4 = this._keyWords[3], j5 = this._sigmaWords[1], j6 = this._nonceWords[0], j7 = this._nonceWords[1], j8 = this._counterWords[0], j9 = this._counterWords[1], j10 = this._sigmaWords[2], j11 = this._keyWords[4], j12 = this._keyWords[5], j13 = this._keyWords[6], j14 = this._keyWords[7], j15 = this._sigmaWords[3];
                    let x0 = j0, x1 = j1, x2 = j2, x3 = j3, x4 = j4, x5 = j5, x6 = j6, x7 = j7, x8 = j8, x9 = j9, x10 = j10, x11 = j11, x12 = j12, x13 = j13, x14 = j14, x15 = j15;
                    let u;
                    for (let i = 0; i < this._rounds; i += 2) {
                      u = x0 + x12;
                      x4 ^= u << 7 | u >>> 32 - 7;
                      u = x4 + x0;
                      x8 ^= u << 9 | u >>> 32 - 9;
                      u = x8 + x4;
                      x12 ^= u << 13 | u >>> 32 - 13;
                      u = x12 + x8;
                      x0 ^= u << 18 | u >>> 32 - 18;
                      u = x5 + x1;
                      x9 ^= u << 7 | u >>> 32 - 7;
                      u = x9 + x5;
                      x13 ^= u << 9 | u >>> 32 - 9;
                      u = x13 + x9;
                      x1 ^= u << 13 | u >>> 32 - 13;
                      u = x1 + x13;
                      x5 ^= u << 18 | u >>> 32 - 18;
                      u = x10 + x6;
                      x14 ^= u << 7 | u >>> 32 - 7;
                      u = x14 + x10;
                      x2 ^= u << 9 | u >>> 32 - 9;
                      u = x2 + x14;
                      x6 ^= u << 13 | u >>> 32 - 13;
                      u = x6 + x2;
                      x10 ^= u << 18 | u >>> 32 - 18;
                      u = x15 + x11;
                      x3 ^= u << 7 | u >>> 32 - 7;
                      u = x3 + x15;
                      x7 ^= u << 9 | u >>> 32 - 9;
                      u = x7 + x3;
                      x11 ^= u << 13 | u >>> 32 - 13;
                      u = x11 + x7;
                      x15 ^= u << 18 | u >>> 32 - 18;
                      u = x0 + x3;
                      x1 ^= u << 7 | u >>> 32 - 7;
                      u = x1 + x0;
                      x2 ^= u << 9 | u >>> 32 - 9;
                      u = x2 + x1;
                      x3 ^= u << 13 | u >>> 32 - 13;
                      u = x3 + x2;
                      x0 ^= u << 18 | u >>> 32 - 18;
                      u = x5 + x4;
                      x6 ^= u << 7 | u >>> 32 - 7;
                      u = x6 + x5;
                      x7 ^= u << 9 | u >>> 32 - 9;
                      u = x7 + x6;
                      x4 ^= u << 13 | u >>> 32 - 13;
                      u = x4 + x7;
                      x5 ^= u << 18 | u >>> 32 - 18;
                      u = x10 + x9;
                      x11 ^= u << 7 | u >>> 32 - 7;
                      u = x11 + x10;
                      x8 ^= u << 9 | u >>> 32 - 9;
                      u = x8 + x11;
                      x9 ^= u << 13 | u >>> 32 - 13;
                      u = x9 + x8;
                      x10 ^= u << 18 | u >>> 32 - 18;
                      u = x15 + x14;
                      x12 ^= u << 7 | u >>> 32 - 7;
                      u = x12 + x15;
                      x13 ^= u << 9 | u >>> 32 - 9;
                      u = x13 + x12;
                      x14 ^= u << 13 | u >>> 32 - 13;
                      u = x14 + x13;
                      x15 ^= u << 18 | u >>> 32 - 18;
                    }
                    x0 += j0;
                    x1 += j1;
                    x2 += j2;
                    x3 += j3;
                    x4 += j4;
                    x5 += j5;
                    x6 += j6;
                    x7 += j7;
                    x8 += j8;
                    x9 += j9;
                    x10 += j10;
                    x11 += j11;
                    x12 += j12;
                    x13 += j13;
                    x14 += j14;
                    x15 += j15;
                    this._block[0] = x0 >>> 0 & 255;
                    this._block[1] = x0 >>> 8 & 255;
                    this._block[2] = x0 >>> 16 & 255;
                    this._block[3] = x0 >>> 24 & 255;
                    this._block[4] = x1 >>> 0 & 255;
                    this._block[5] = x1 >>> 8 & 255;
                    this._block[6] = x1 >>> 16 & 255;
                    this._block[7] = x1 >>> 24 & 255;
                    this._block[8] = x2 >>> 0 & 255;
                    this._block[9] = x2 >>> 8 & 255;
                    this._block[10] = x2 >>> 16 & 255;
                    this._block[11] = x2 >>> 24 & 255;
                    this._block[12] = x3 >>> 0 & 255;
                    this._block[13] = x3 >>> 8 & 255;
                    this._block[14] = x3 >>> 16 & 255;
                    this._block[15] = x3 >>> 24 & 255;
                    this._block[16] = x4 >>> 0 & 255;
                    this._block[17] = x4 >>> 8 & 255;
                    this._block[18] = x4 >>> 16 & 255;
                    this._block[19] = x4 >>> 24 & 255;
                    this._block[20] = x5 >>> 0 & 255;
                    this._block[21] = x5 >>> 8 & 255;
                    this._block[22] = x5 >>> 16 & 255;
                    this._block[23] = x5 >>> 24 & 255;
                    this._block[24] = x6 >>> 0 & 255;
                    this._block[25] = x6 >>> 8 & 255;
                    this._block[26] = x6 >>> 16 & 255;
                    this._block[27] = x6 >>> 24 & 255;
                    this._block[28] = x7 >>> 0 & 255;
                    this._block[29] = x7 >>> 8 & 255;
                    this._block[30] = x7 >>> 16 & 255;
                    this._block[31] = x7 >>> 24 & 255;
                    this._block[32] = x8 >>> 0 & 255;
                    this._block[33] = x8 >>> 8 & 255;
                    this._block[34] = x8 >>> 16 & 255;
                    this._block[35] = x8 >>> 24 & 255;
                    this._block[36] = x9 >>> 0 & 255;
                    this._block[37] = x9 >>> 8 & 255;
                    this._block[38] = x9 >>> 16 & 255;
                    this._block[39] = x9 >>> 24 & 255;
                    this._block[40] = x10 >>> 0 & 255;
                    this._block[41] = x10 >>> 8 & 255;
                    this._block[42] = x10 >>> 16 & 255;
                    this._block[43] = x10 >>> 24 & 255;
                    this._block[44] = x11 >>> 0 & 255;
                    this._block[45] = x11 >>> 8 & 255;
                    this._block[46] = x11 >>> 16 & 255;
                    this._block[47] = x11 >>> 24 & 255;
                    this._block[48] = x12 >>> 0 & 255;
                    this._block[49] = x12 >>> 8 & 255;
                    this._block[50] = x12 >>> 16 & 255;
                    this._block[51] = x12 >>> 24 & 255;
                    this._block[52] = x13 >>> 0 & 255;
                    this._block[53] = x13 >>> 8 & 255;
                    this._block[54] = x13 >>> 16 & 255;
                    this._block[55] = x13 >>> 24 & 255;
                    this._block[56] = x14 >>> 0 & 255;
                    this._block[57] = x14 >>> 8 & 255;
                    this._block[58] = x14 >>> 16 & 255;
                    this._block[59] = x14 >>> 24 & 255;
                    this._block[60] = x15 >>> 0 & 255;
                    this._block[61] = x15 >>> 8 & 255;
                    this._block[62] = x15 >>> 16 & 255;
                    this._block[63] = x15 >>> 24 & 255;
                  }
                }
                exports2.Salsa20 = Salsa20;
              })
            ),
            /***/
            "./defs/consts.ts": (
              /*!************************!*\
                !*** ./defs/consts.ts ***!
                \************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.Icons = exports2.Defaults = exports2.AutoTypeObfuscationOptions = exports2.CipherId = exports2.KdfId = exports2.CrsAlgorithm = exports2.CompressionAlgorithm = exports2.ErrorCodes = exports2.Signatures = void 0;
                exports2.Signatures = {
                  FileMagic: 2594363651,
                  Sig2Kdbx: 3041655655,
                  Sig2Kdb: 3041655653
                };
                exports2.ErrorCodes = {
                  NotImplemented: "NotImplemented",
                  InvalidArg: "InvalidArg",
                  BadSignature: "BadSignature",
                  InvalidVersion: "InvalidVersion",
                  Unsupported: "Unsupported",
                  FileCorrupt: "FileCorrupt",
                  InvalidKey: "InvalidKey",
                  MergeError: "MergeError",
                  InvalidState: "InvalidState"
                };
                exports2.CompressionAlgorithm = {
                  None: 0,
                  GZip: 1
                };
                exports2.CrsAlgorithm = {
                  Null: 0,
                  ArcFourVariant: 1,
                  Salsa20: 2,
                  ChaCha20: 3
                };
                exports2.KdfId = {
                  Argon2: "72Nt34wpREuR96mkA+MKDA==",
                  Argon2d: "72Nt34wpREuR96mkA+MKDA==",
                  Argon2id: "nimLGVbbR3OyPfw+xvCh5g==",
                  Aes: "ydnzmmKKRGC/dA0IwYpP6g=="
                };
                exports2.CipherId = {
                  Aes: "McHy5r9xQ1C+WAUhavxa/w==",
                  ChaCha20: "1gOKK4tvTLWlJDOaMdu1mg=="
                };
                exports2.AutoTypeObfuscationOptions = {
                  None: 0,
                  UseClipboard: 1
                };
                exports2.Defaults = {
                  KeyEncryptionRounds: 3e5,
                  MntncHistoryDays: 365,
                  HistoryMaxItems: 10,
                  HistoryMaxSize: 6 * 1024 * 1024,
                  RecycleBinName: "Recycle Bin"
                };
                exports2.Icons = {
                  Key: 0,
                  World: 1,
                  Warning: 2,
                  NetworkServer: 3,
                  MarkedDirectory: 4,
                  UserCommunication: 5,
                  Parts: 6,
                  Notepad: 7,
                  WorldSocket: 8,
                  Identity: 9,
                  PaperReady: 10,
                  Digicam: 11,
                  IRCommunication: 12,
                  MultiKeys: 13,
                  Energy: 14,
                  Scanner: 15,
                  WorldStar: 16,
                  CDRom: 17,
                  Monitor: 18,
                  EMail: 19,
                  Configuration: 20,
                  ClipboardReady: 21,
                  PaperNew: 22,
                  Screen: 23,
                  EnergyCareful: 24,
                  EMailBox: 25,
                  Disk: 26,
                  Drive: 27,
                  PaperQ: 28,
                  TerminalEncrypted: 29,
                  Console: 30,
                  Printer: 31,
                  ProgramIcons: 32,
                  Run: 33,
                  Settings: 34,
                  WorldComputer: 35,
                  Archive: 36,
                  Homebanking: 37,
                  DriveWindows: 39,
                  Clock: 39,
                  EMailSearch: 40,
                  PaperFlag: 41,
                  Memory: 42,
                  TrashBin: 43,
                  Note: 44,
                  Expired: 45,
                  Info: 46,
                  Package: 47,
                  Folder: 48,
                  FolderOpen: 49,
                  FolderPackage: 50,
                  LockOpen: 51,
                  PaperLocked: 52,
                  Checked: 53,
                  Pen: 54,
                  Thumbnail: 55,
                  Book: 56,
                  List: 57,
                  UserKey: 58,
                  Tool: 59,
                  Home: 60,
                  Star: 61,
                  Tux: 62,
                  Feather: 63,
                  Apple: 64,
                  Wiki: 65,
                  Money: 66,
                  Certificate: 67,
                  BlackBerry: 68
                };
              })
            ),
            /***/
            "./defs/xml-names.ts": (
              /*!***************************!*\
                !*** ./defs/xml-names.ts ***!
                \***************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.Val = exports2.Attr = exports2.Elem = void 0;
                exports2.Elem = {
                  DocNode: "KeePassFile",
                  Meta: "Meta",
                  Root: "Root",
                  Group: "Group",
                  Entry: "Entry",
                  Generator: "Generator",
                  HeaderHash: "HeaderHash",
                  SettingsChanged: "SettingsChanged",
                  DbName: "DatabaseName",
                  DbNameChanged: "DatabaseNameChanged",
                  DbDesc: "DatabaseDescription",
                  DbDescChanged: "DatabaseDescriptionChanged",
                  DbDefaultUser: "DefaultUserName",
                  DbDefaultUserChanged: "DefaultUserNameChanged",
                  DbMntncHistoryDays: "MaintenanceHistoryDays",
                  DbColor: "Color",
                  DbKeyChanged: "MasterKeyChanged",
                  DbKeyChangeRec: "MasterKeyChangeRec",
                  DbKeyChangeForce: "MasterKeyChangeForce",
                  RecycleBinEnabled: "RecycleBinEnabled",
                  RecycleBinUuid: "RecycleBinUUID",
                  RecycleBinChanged: "RecycleBinChanged",
                  EntryTemplatesGroup: "EntryTemplatesGroup",
                  EntryTemplatesGroupChanged: "EntryTemplatesGroupChanged",
                  HistoryMaxItems: "HistoryMaxItems",
                  HistoryMaxSize: "HistoryMaxSize",
                  LastSelectedGroup: "LastSelectedGroup",
                  LastTopVisibleGroup: "LastTopVisibleGroup",
                  MemoryProt: "MemoryProtection",
                  ProtTitle: "ProtectTitle",
                  ProtUserName: "ProtectUserName",
                  ProtPassword: "ProtectPassword",
                  ProtUrl: "ProtectURL",
                  ProtNotes: "ProtectNotes",
                  CustomIcons: "CustomIcons",
                  CustomIconItem: "Icon",
                  CustomIconItemID: "UUID",
                  CustomIconItemData: "Data",
                  CustomIconItemName: "Name",
                  AutoType: "AutoType",
                  History: "History",
                  Name: "Name",
                  Notes: "Notes",
                  Uuid: "UUID",
                  Icon: "IconID",
                  CustomIconID: "CustomIconUUID",
                  FgColor: "ForegroundColor",
                  BgColor: "BackgroundColor",
                  OverrideUrl: "OverrideURL",
                  Times: "Times",
                  Tags: "Tags",
                  QualityCheck: "QualityCheck",
                  PreviousParentGroup: "PreviousParentGroup",
                  CreationTime: "CreationTime",
                  LastModTime: "LastModificationTime",
                  LastAccessTime: "LastAccessTime",
                  ExpiryTime: "ExpiryTime",
                  Expires: "Expires",
                  UsageCount: "UsageCount",
                  LocationChanged: "LocationChanged",
                  GroupDefaultAutoTypeSeq: "DefaultAutoTypeSequence",
                  EnableAutoType: "EnableAutoType",
                  EnableSearching: "EnableSearching",
                  String: "String",
                  Binary: "Binary",
                  Key: "Key",
                  Value: "Value",
                  AutoTypeEnabled: "Enabled",
                  AutoTypeObfuscation: "DataTransferObfuscation",
                  AutoTypeDefaultSeq: "DefaultSequence",
                  AutoTypeItem: "Association",
                  Window: "Window",
                  KeystrokeSequence: "KeystrokeSequence",
                  Binaries: "Binaries",
                  IsExpanded: "IsExpanded",
                  LastTopVisibleEntry: "LastTopVisibleEntry",
                  DeletedObjects: "DeletedObjects",
                  DeletedObject: "DeletedObject",
                  DeletionTime: "DeletionTime",
                  CustomData: "CustomData",
                  StringDictExItem: "Item"
                };
                exports2.Attr = {
                  Id: "ID",
                  Ref: "Ref",
                  Protected: "Protected",
                  ProtectedInMemPlainXml: "ProtectInMemory",
                  Compressed: "Compressed"
                };
                exports2.Val = {
                  False: "False",
                  True: "True"
                };
              })
            ),
            /***/
            "./errors/kdbx-error.ts": (
              /*!******************************!*\
                !*** ./errors/kdbx-error.ts ***!
                \******************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxError = void 0;
                class KdbxError extends Error {
                  constructor(code, message) {
                    super("Error " + code + (message ? ": " + message : ""));
                    this.name = "KdbxError";
                    this.code = code;
                  }
                }
                exports2.KdbxError = KdbxError;
              })
            ),
            /***/
            "./format/kdbx-binaries.ts": (
              /*!*********************************!*\
                !*** ./format/kdbx-binaries.ts ***!
                \*********************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxBinaries = void 0;
                const CryptoEngine = __webpack_require__2(
                  /*! ./../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const protected_value_1 = __webpack_require__2(
                  /*! ../crypto/protected-value */
                  "./crypto/protected-value.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                class KdbxBinaries {
                  constructor() {
                    this._mapById = /* @__PURE__ */ new Map();
                    this._mapByHash = /* @__PURE__ */ new Map();
                    this._idToHash = /* @__PURE__ */ new Map();
                  }
                  computeHashes() {
                    const promises = [...this._mapById].map(([id, binary]) => KdbxBinaries.getBinaryHash(binary).then((hash) => {
                      this._idToHash.set(id, hash);
                      this._mapByHash.set(hash, binary);
                    }));
                    return Promise.all(promises).then(() => {
                      this._mapById.clear();
                    });
                  }
                  static getBinaryHash(binary) {
                    let promise;
                    if (binary instanceof protected_value_1.ProtectedValue) {
                      promise = binary.getHash();
                    } else {
                      binary = (0, byte_utils_1.arrayToBuffer)(binary);
                      promise = CryptoEngine.sha256(binary);
                    }
                    return promise.then(byte_utils_1.bytesToHex);
                  }
                  add(value) {
                    if (value instanceof Uint8Array) {
                      value = (0, byte_utils_1.arrayToBuffer)(value);
                    }
                    return KdbxBinaries.getBinaryHash(value).then((hash) => {
                      this._mapByHash.set(hash, value);
                      return { hash, value };
                    });
                  }
                  addWithNextId(value) {
                    const id = this._mapById.size.toString();
                    this.addWithId(id, value);
                  }
                  addWithId(id, value) {
                    if (value instanceof Uint8Array) {
                      value = (0, byte_utils_1.arrayToBuffer)(value);
                    }
                    this._mapById.set(id, value);
                  }
                  addWithHash(binary) {
                    this._mapByHash.set(binary.hash, binary.value);
                  }
                  deleteWithHash(hash) {
                    this._mapByHash.delete(hash);
                  }
                  getByRef(binaryRef) {
                    const hash = this._idToHash.get(binaryRef.ref);
                    if (!hash) {
                      return void 0;
                    }
                    const value = this._mapByHash.get(hash);
                    if (!value) {
                      return void 0;
                    }
                    return { hash, value };
                  }
                  getRefByHash(hash) {
                    const ref = [...this._mapByHash.keys()].indexOf(hash);
                    if (ref < 0) {
                      return void 0;
                    }
                    return { ref: ref.toString() };
                  }
                  getAll() {
                    return [...this._mapByHash.values()].map((value, index) => {
                      return { ref: index.toString(), value };
                    });
                  }
                  getAllWithHashes() {
                    return [...this._mapByHash].map(([hash, value]) => ({
                      hash,
                      value
                    }));
                  }
                  getValueByHash(hash) {
                    return this._mapByHash.get(hash);
                  }
                  static isKdbxBinaryRef(binary) {
                    var _a;
                    return !!((_a = binary) === null || _a === void 0 ? void 0 : _a.ref);
                  }
                  static isKdbxBinaryWithHash(binary) {
                    var _a;
                    return !!((_a = binary) === null || _a === void 0 ? void 0 : _a.hash);
                  }
                }
                exports2.KdbxBinaries = KdbxBinaries;
              })
            ),
            /***/
            "./format/kdbx-context.ts": (
              /*!********************************!*\
                !*** ./format/kdbx-context.ts ***!
                \********************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxContext = void 0;
                const XmlUtils = __webpack_require__2(
                  /*! ./../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                class KdbxContext {
                  constructor(opts) {
                    this.kdbx = opts.kdbx;
                    this.exportXml = !!opts.exportXml;
                  }
                  setXmlDate(node, dt) {
                    const isBinary = this.kdbx.versionMajor >= 4 && !this.exportXml;
                    XmlUtils.setDate(node, dt, isBinary);
                  }
                }
                exports2.KdbxContext = KdbxContext;
              })
            ),
            /***/
            "./format/kdbx-credentials.ts": (
              /*!************************************!*\
                !*** ./format/kdbx-credentials.ts ***!
                \************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxCredentials = void 0;
                const XmlUtils = __webpack_require__2(
                  /*! ../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const protected_value_1 = __webpack_require__2(
                  /*! ../crypto/protected-value */
                  "./crypto/protected-value.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                class KdbxCredentials {
                  constructor(password, keyFile, challengeResponse) {
                    this.ready = Promise.all([
                      this.setPassword(password),
                      this.setKeyFile(keyFile),
                      this.setChallengeResponse(challengeResponse)
                    ]).then(() => this);
                  }
                  setPassword(password) {
                    if (!password) {
                      this.passwordHash = void 0;
                      return Promise.resolve();
                    } else if (password instanceof protected_value_1.ProtectedValue) {
                      return password.getHash().then((hash) => {
                        this.passwordHash = protected_value_1.ProtectedValue.fromBinary(hash);
                      });
                    } else {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "password"));
                    }
                  }
                  setKeyFile(keyFile) {
                    if (keyFile && !(keyFile instanceof ArrayBuffer) && !(keyFile instanceof Uint8Array)) {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "keyFile"));
                    }
                    if (keyFile) {
                      if (keyFile.byteLength === 32) {
                        this.keyFileHash = protected_value_1.ProtectedValue.fromBinary((0, byte_utils_1.arrayToBuffer)(keyFile));
                        return Promise.resolve();
                      }
                      let keyFileVersion;
                      let dataEl;
                      try {
                        const keyFileStr = (0, byte_utils_1.bytesToString)((0, byte_utils_1.arrayToBuffer)(keyFile));
                        if (/^[a-f\d]{64}$/i.exec(keyFileStr)) {
                          const bytes = (0, byte_utils_1.hexToBytes)(keyFileStr);
                          this.keyFileHash = protected_value_1.ProtectedValue.fromBinary(bytes);
                          return Promise.resolve();
                        }
                        const xml = XmlUtils.parse(keyFileStr.trim());
                        const metaEl = XmlUtils.getChildNode(xml.documentElement, "Meta");
                        if (!metaEl) {
                          return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "key file without meta"));
                        }
                        const versionEl = XmlUtils.getChildNode(metaEl, "Version");
                        if (!(versionEl === null || versionEl === void 0 ? void 0 : versionEl.textContent)) {
                          return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "key file without version"));
                        }
                        keyFileVersion = +versionEl.textContent.split(".")[0];
                        const keyEl = XmlUtils.getChildNode(xml.documentElement, "Key");
                        if (!keyEl) {
                          return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "key file without key"));
                        }
                        dataEl = XmlUtils.getChildNode(keyEl, "Data");
                        if (!(dataEl === null || dataEl === void 0 ? void 0 : dataEl.textContent)) {
                          return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "key file without key data"));
                        }
                      } catch (e) {
                        return CryptoEngine.sha256(keyFile).then((hash) => {
                          this.keyFileHash = protected_value_1.ProtectedValue.fromBinary(hash);
                        });
                      }
                      switch (keyFileVersion) {
                        case 1:
                          this.keyFileHash = protected_value_1.ProtectedValue.fromBinary((0, byte_utils_1.base64ToBytes)(dataEl.textContent));
                          break;
                        case 2: {
                          const keyFileData = (0, byte_utils_1.hexToBytes)(dataEl.textContent.replace(/\s+/g, ""));
                          const keyFileDataHash = dataEl.getAttribute("Hash");
                          return CryptoEngine.sha256(keyFileData).then((computedHash) => {
                            const computedHashStr = (0, byte_utils_1.bytesToHex)(new Uint8Array(computedHash).subarray(0, 4)).toUpperCase();
                            if (computedHashStr !== keyFileDataHash) {
                              throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "key file data hash mismatch");
                            }
                            this.keyFileHash = protected_value_1.ProtectedValue.fromBinary(keyFileData);
                          });
                        }
                        default: {
                          return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad keyfile version"));
                        }
                      }
                    } else {
                      this.keyFileHash = void 0;
                    }
                    return Promise.resolve();
                  }
                  setChallengeResponse(challengeResponse) {
                    this._challengeResponse = challengeResponse;
                    return Promise.resolve();
                  }
                  getHash(challenge) {
                    return this.ready.then(() => {
                      return this.getChallengeResponse(challenge).then((chalResp) => {
                        const buffers = [];
                        if (this.passwordHash) {
                          buffers.push(this.passwordHash.getBinary());
                        }
                        if (this.keyFileHash) {
                          buffers.push(this.keyFileHash.getBinary());
                        }
                        if (chalResp) {
                          buffers.push(new Uint8Array(chalResp));
                        }
                        const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
                        const allBytes = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const buffer of buffers) {
                          allBytes.set(buffer, offset);
                          (0, byte_utils_1.zeroBuffer)(buffer);
                          offset += buffer.length;
                        }
                        return CryptoEngine.sha256((0, byte_utils_1.arrayToBuffer)(allBytes)).then((hash) => {
                          (0, byte_utils_1.zeroBuffer)(allBytes);
                          return hash;
                        });
                      });
                    });
                  }
                  getChallengeResponse(challenge) {
                    return Promise.resolve().then(() => {
                      if (!this._challengeResponse || !challenge) {
                        return null;
                      }
                      return this._challengeResponse(challenge).then((response) => {
                        return CryptoEngine.sha256((0, byte_utils_1.arrayToBuffer)(response)).then((hash) => {
                          (0, byte_utils_1.zeroBuffer)(response);
                          return hash;
                        });
                      });
                    });
                  }
                  static createRandomKeyFile(version = 1) {
                    const keyLength = 32;
                    const keyBytes = CryptoEngine.random(keyLength), salt = CryptoEngine.random(keyLength);
                    for (let i = 0; i < keyLength; i++) {
                      keyBytes[i] ^= salt[i];
                      keyBytes[i] ^= Math.random() * 1e3 % 255;
                    }
                    return KdbxCredentials.createKeyFileWithHash(keyBytes, version);
                  }
                  static createKeyFileWithHash(keyBytes, version = 1) {
                    const xmlVersion = version === 2 ? "2.0" : "1.00";
                    const dataPadding = "        ";
                    let makeDataElPromise;
                    if (version === 2) {
                      const keyDataPadding = dataPadding + "    ";
                      makeDataElPromise = CryptoEngine.sha256(keyBytes).then((computedHash) => {
                        const keyHash = (0, byte_utils_1.bytesToHex)(new Uint8Array(computedHash).subarray(0, 4)).toUpperCase();
                        const keyStr = (0, byte_utils_1.bytesToHex)(keyBytes).toUpperCase();
                        let dataElXml = dataPadding + '<Data Hash="' + keyHash + '">\n';
                        for (let num = 0; num < 2; num++) {
                          const parts = [0, 1, 2, 3].map((ix) => {
                            return keyStr.substr(num * 32 + ix * 8, 8);
                          });
                          dataElXml += keyDataPadding;
                          dataElXml += parts.join(" ");
                          dataElXml += "\n";
                        }
                        dataElXml += dataPadding + "</Data>\n";
                        return dataElXml;
                      });
                    } else {
                      const dataElXml = dataPadding + "<Data>" + (0, byte_utils_1.bytesToBase64)(keyBytes) + "</Data>\n";
                      makeDataElPromise = Promise.resolve(dataElXml);
                    }
                    return makeDataElPromise.then((dataElXml) => {
                      const xml = '<?xml version="1.0" encoding="utf-8"?>\n<KeyFile>\n    <Meta>\n        <Version>' + xmlVersion + "</Version>\n    </Meta>\n    <Key>\n" + dataElXml + "    </Key>\n</KeyFile>";
                      return (0, byte_utils_1.stringToBytes)(xml);
                    });
                  }
                }
                exports2.KdbxCredentials = KdbxCredentials;
              })
            ),
            /***/
            "./format/kdbx-custom-data.ts": (
              /*!************************************!*\
                !*** ./format/kdbx-custom-data.ts ***!
                \************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxCustomData = void 0;
                const XmlUtils = __webpack_require__2(
                  /*! ../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const XmlNames = __webpack_require__2(
                  /*! ../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                class KdbxCustomData {
                  static read(node) {
                    const customData = /* @__PURE__ */ new Map();
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName === XmlNames.Elem.StringDictExItem) {
                        this.readItem(childNode, customData);
                      }
                    }
                    return customData;
                  }
                  static write(parentNode, ctx, customData) {
                    if (!customData) {
                      return;
                    }
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.CustomData);
                    for (const [key, item] of customData) {
                      if (item === null || item === void 0 ? void 0 : item.value) {
                        const itemNode = XmlUtils.addChildNode(node, XmlNames.Elem.StringDictExItem);
                        XmlUtils.setText(XmlUtils.addChildNode(itemNode, XmlNames.Elem.Key), key);
                        XmlUtils.setText(XmlUtils.addChildNode(itemNode, XmlNames.Elem.Value), item.value);
                        if (item.lastModified && ctx.kdbx.versionIsAtLeast(4, 1)) {
                          XmlUtils.setDate(XmlUtils.addChildNode(itemNode, XmlNames.Elem.LastModTime), item.lastModified);
                        }
                      }
                    }
                  }
                  static readItem(node, customData) {
                    let key, value, lastModified;
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.Key:
                          key = XmlUtils.getText(childNode);
                          break;
                        case XmlNames.Elem.Value:
                          value = XmlUtils.getText(childNode);
                          break;
                        case XmlNames.Elem.LastModTime:
                          lastModified = XmlUtils.getDate(childNode);
                          break;
                      }
                    }
                    if (key && value !== void 0) {
                      const item = { value };
                      if (lastModified) {
                        item.lastModified = lastModified;
                      }
                      customData.set(key, item);
                    }
                  }
                }
                exports2.KdbxCustomData = KdbxCustomData;
              })
            ),
            /***/
            "./format/kdbx-deleted-object.ts": (
              /*!***************************************!*\
                !*** ./format/kdbx-deleted-object.ts ***!
                \***************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxDeletedObject = void 0;
                const XmlUtils = __webpack_require__2(
                  /*! ../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const XmlNames = __webpack_require__2(
                  /*! ../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                class KdbxDeletedObject {
                  readNode(node) {
                    switch (node.tagName) {
                      case XmlNames.Elem.Uuid:
                        this.uuid = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.DeletionTime:
                        this.deletionTime = XmlUtils.getDate(node);
                        break;
                    }
                  }
                  write(parentNode, ctx) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.DeletedObject);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.Uuid), this.uuid);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.DeletionTime), this.deletionTime);
                  }
                  static read(xmlNode) {
                    const obj = new KdbxDeletedObject();
                    for (let i = 0, cn = xmlNode.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName) {
                        obj.readNode(childNode);
                      }
                    }
                    return obj;
                  }
                }
                exports2.KdbxDeletedObject = KdbxDeletedObject;
              })
            ),
            /***/
            "./format/kdbx-entry.ts": (
              /*!******************************!*\
                !*** ./format/kdbx-entry.ts ***!
                \******************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxEntry = void 0;
                const XmlNames = __webpack_require__2(
                  /*! ./../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                const XmlUtils = __webpack_require__2(
                  /*! ./../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const kdbx_times_1 = __webpack_require__2(
                  /*! ./kdbx-times */
                  "./format/kdbx-times.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const protected_value_1 = __webpack_require__2(
                  /*! ../crypto/protected-value */
                  "./crypto/protected-value.ts"
                );
                const kdbx_custom_data_1 = __webpack_require__2(
                  /*! ./kdbx-custom-data */
                  "./format/kdbx-custom-data.ts"
                );
                const kdbx_uuid_1 = __webpack_require__2(
                  /*! ./kdbx-uuid */
                  "./format/kdbx-uuid.ts"
                );
                const kdbx_binaries_1 = __webpack_require__2(
                  /*! ./kdbx-binaries */
                  "./format/kdbx-binaries.ts"
                );
                class KdbxEntry {
                  constructor() {
                    this.uuid = new kdbx_uuid_1.KdbxUuid();
                    this.tags = [];
                    this.times = new kdbx_times_1.KdbxTimes();
                    this.fields = /* @__PURE__ */ new Map();
                    this.binaries = /* @__PURE__ */ new Map();
                    this.autoType = {
                      enabled: true,
                      obfuscation: consts_1.AutoTypeObfuscationOptions.None,
                      items: []
                    };
                    this.history = [];
                  }
                  get lastModTime() {
                    var _a, _b;
                    return (_b = (_a = this.times.lastModTime) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0;
                  }
                  get locationChanged() {
                    var _a, _b;
                    return (_b = (_a = this.times.locationChanged) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0;
                  }
                  readNode(node, ctx) {
                    var _a, _b;
                    switch (node.tagName) {
                      case XmlNames.Elem.Uuid:
                        this.uuid = (_a = XmlUtils.getUuid(node)) !== null && _a !== void 0 ? _a : new kdbx_uuid_1.KdbxUuid();
                        break;
                      case XmlNames.Elem.Icon:
                        this.icon = XmlUtils.getNumber(node) || consts_1.Icons.Key;
                        break;
                      case XmlNames.Elem.CustomIconID:
                        this.customIcon = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.FgColor:
                        this.fgColor = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.BgColor:
                        this.bgColor = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.OverrideUrl:
                        this.overrideUrl = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.Tags:
                        this.tags = XmlUtils.getTags(node);
                        break;
                      case XmlNames.Elem.Times:
                        this.times = kdbx_times_1.KdbxTimes.read(node);
                        break;
                      case XmlNames.Elem.String:
                        this.readField(node);
                        break;
                      case XmlNames.Elem.Binary:
                        this.readBinary(node, ctx);
                        break;
                      case XmlNames.Elem.AutoType:
                        this.readAutoType(node);
                        break;
                      case XmlNames.Elem.History:
                        this.readHistory(node, ctx);
                        break;
                      case XmlNames.Elem.CustomData:
                        this.readCustomData(node);
                        break;
                      case XmlNames.Elem.QualityCheck:
                        this.qualityCheck = (_b = XmlUtils.getBoolean(node)) !== null && _b !== void 0 ? _b : void 0;
                        break;
                      case XmlNames.Elem.PreviousParentGroup:
                        this.previousParentGroup = XmlUtils.getUuid(node);
                        break;
                    }
                  }
                  readField(node) {
                    const keyNode = XmlUtils.getChildNode(node, XmlNames.Elem.Key), valueNode = XmlUtils.getChildNode(node, XmlNames.Elem.Value);
                    if (keyNode && valueNode) {
                      const key = XmlUtils.getText(keyNode), value = XmlUtils.getProtectedText(valueNode);
                      if (key) {
                        this.fields.set(key, value || "");
                      }
                    }
                  }
                  writeFields(parentNode) {
                    for (const [field, value] of this.fields) {
                      if (value !== void 0 && value !== null) {
                        const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.String);
                        XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.Key), field);
                        XmlUtils.setProtectedText(XmlUtils.addChildNode(node, XmlNames.Elem.Value), value);
                      }
                    }
                  }
                  readBinary(node, ctx) {
                    const keyNode = XmlUtils.getChildNode(node, XmlNames.Elem.Key), valueNode = XmlUtils.getChildNode(node, XmlNames.Elem.Value);
                    if (keyNode && valueNode) {
                      const key = XmlUtils.getText(keyNode), value = XmlUtils.getProtectedBinary(valueNode);
                      if (key && value) {
                        if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryRef(value)) {
                          const binary = ctx.kdbx.binaries.getByRef(value);
                          if (binary) {
                            this.binaries.set(key, binary);
                          }
                        } else {
                          this.binaries.set(key, value);
                        }
                      }
                    }
                  }
                  writeBinaries(parentNode, ctx) {
                    for (const [id, data] of this.binaries) {
                      let bin;
                      if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryWithHash(data)) {
                        const binaryRef = ctx.kdbx.binaries.getRefByHash(data.hash);
                        if (!binaryRef) {
                          return;
                        }
                        bin = binaryRef;
                      } else {
                        bin = data;
                      }
                      const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.Binary);
                      XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.Key), id);
                      XmlUtils.setProtectedBinary(XmlUtils.addChildNode(node, XmlNames.Elem.Value), bin);
                    }
                  }
                  readAutoType(node) {
                    var _a;
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.AutoTypeEnabled:
                          this.autoType.enabled = (_a = XmlUtils.getBoolean(childNode)) !== null && _a !== void 0 ? _a : true;
                          break;
                        case XmlNames.Elem.AutoTypeObfuscation:
                          this.autoType.obfuscation = XmlUtils.getNumber(childNode) || consts_1.AutoTypeObfuscationOptions.None;
                          break;
                        case XmlNames.Elem.AutoTypeDefaultSeq:
                          this.autoType.defaultSequence = XmlUtils.getText(childNode);
                          break;
                        case XmlNames.Elem.AutoTypeItem:
                          this.readAutoTypeItem(childNode);
                          break;
                      }
                    }
                  }
                  readAutoTypeItem(node) {
                    let window2 = "";
                    let keystrokeSequence = "";
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.Window:
                          window2 = XmlUtils.getText(childNode) || "";
                          break;
                        case XmlNames.Elem.KeystrokeSequence:
                          keystrokeSequence = XmlUtils.getText(childNode) || "";
                          break;
                      }
                    }
                    if (window2 && keystrokeSequence) {
                      this.autoType.items.push({ window: window2, keystrokeSequence });
                    }
                  }
                  writeAutoType(parentNode) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.AutoType);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.AutoTypeEnabled), this.autoType.enabled);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.AutoTypeObfuscation), this.autoType.obfuscation || consts_1.AutoTypeObfuscationOptions.None);
                    if (this.autoType.defaultSequence) {
                      XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.AutoTypeDefaultSeq), this.autoType.defaultSequence);
                    }
                    for (let i = 0; i < this.autoType.items.length; i++) {
                      const item = this.autoType.items[i];
                      const itemNode = XmlUtils.addChildNode(node, XmlNames.Elem.AutoTypeItem);
                      XmlUtils.setText(XmlUtils.addChildNode(itemNode, XmlNames.Elem.Window), item.window);
                      XmlUtils.setText(XmlUtils.addChildNode(itemNode, XmlNames.Elem.KeystrokeSequence), item.keystrokeSequence);
                    }
                  }
                  readHistory(node, ctx) {
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.Entry:
                          this.history.push(KdbxEntry.read(childNode, ctx));
                          break;
                      }
                    }
                  }
                  writeHistory(parentNode, ctx) {
                    const historyNode = XmlUtils.addChildNode(parentNode, XmlNames.Elem.History);
                    for (const historyEntry of this.history) {
                      historyEntry.write(historyNode, ctx);
                    }
                  }
                  readCustomData(node) {
                    this.customData = kdbx_custom_data_1.KdbxCustomData.read(node);
                  }
                  writeCustomData(parentNode, ctx) {
                    if (this.customData) {
                      kdbx_custom_data_1.KdbxCustomData.write(parentNode, ctx, this.customData);
                    }
                  }
                  setField(name, str, secure = false) {
                    this.fields.set(name, secure ? protected_value_1.ProtectedValue.fromString(str) : str);
                  }
                  addHistoryTombstone(isAdded, dt) {
                    if (!this._editState) {
                      this._editState = { added: [], deleted: [] };
                    }
                    this._editState[isAdded ? "added" : "deleted"].push(dt.getTime());
                  }
                  write(parentNode, ctx) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.Entry);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.Uuid), this.uuid);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.Icon), this.icon || consts_1.Icons.Key);
                    if (this.customIcon) {
                      XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.CustomIconID), this.customIcon);
                    }
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.FgColor), this.fgColor);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.BgColor), this.bgColor);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.OverrideUrl), this.overrideUrl);
                    XmlUtils.setTags(XmlUtils.addChildNode(node, XmlNames.Elem.Tags), this.tags);
                    if (typeof this.qualityCheck === "boolean" && ctx.kdbx.versionIsAtLeast(4, 1)) {
                      XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.QualityCheck), this.qualityCheck);
                    }
                    if (this.previousParentGroup !== void 0 && ctx.kdbx.versionIsAtLeast(4, 1)) {
                      XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.PreviousParentGroup), this.previousParentGroup);
                    }
                    this.times.write(node, ctx);
                    this.writeFields(node);
                    this.writeBinaries(node, ctx);
                    this.writeAutoType(node);
                    this.writeCustomData(node, ctx);
                    if (parentNode.tagName !== XmlNames.Elem.History) {
                      this.writeHistory(node, ctx);
                    }
                  }
                  pushHistory() {
                    const historyEntry = new KdbxEntry();
                    historyEntry.copyFrom(this);
                    this.history.push(historyEntry);
                    if (historyEntry.times.lastModTime) {
                      this.addHistoryTombstone(true, historyEntry.times.lastModTime);
                    }
                  }
                  removeHistory(index, count = 1) {
                    for (let ix = index; ix < index + count; ix++) {
                      if (ix < this.history.length) {
                        const lastModTime = this.history[ix].times.lastModTime;
                        if (lastModTime) {
                          this.addHistoryTombstone(false, lastModTime);
                        }
                      }
                    }
                    this.history.splice(index, count);
                  }
                  copyFrom(entry) {
                    this.uuid = entry.uuid;
                    this.icon = entry.icon;
                    this.customIcon = entry.customIcon;
                    this.fgColor = entry.fgColor;
                    this.bgColor = entry.bgColor;
                    this.overrideUrl = entry.overrideUrl;
                    this.tags = entry.tags.slice();
                    this.times = entry.times.clone();
                    this.fields = /* @__PURE__ */ new Map();
                    for (const [name, value] of entry.fields) {
                      if (value instanceof protected_value_1.ProtectedValue) {
                        this.fields.set(name, value.clone());
                      } else {
                        this.fields.set(name, value);
                      }
                    }
                    this.binaries = /* @__PURE__ */ new Map();
                    for (const [name, value] of entry.binaries) {
                      if (value instanceof protected_value_1.ProtectedValue) {
                        this.binaries.set(name, value.clone());
                      } else if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryWithHash(value)) {
                        this.binaries.set(name, { hash: value.hash, value: value.value });
                      } else {
                        this.binaries.set(name, value);
                      }
                    }
                    this.autoType = JSON.parse(JSON.stringify(entry.autoType));
                  }
                  merge(objectMap) {
                    const remoteEntry = objectMap.remoteEntries.get(this.uuid.id);
                    if (!remoteEntry) {
                      return;
                    }
                    const remoteHistory = remoteEntry.history.slice();
                    if (this.lastModTime < remoteEntry.lastModTime) {
                      this.pushHistory();
                      this.copyFrom(remoteEntry);
                    } else if (this.lastModTime > remoteEntry.lastModTime) {
                      const existsInHistory = this.history.some((historyEntry) => {
                        return historyEntry.lastModTime === remoteEntry.lastModTime;
                      });
                      if (!existsInHistory) {
                        const historyEntry = new KdbxEntry();
                        historyEntry.copyFrom(remoteEntry);
                        remoteHistory.push(historyEntry);
                      }
                    }
                    this.history = this.mergeHistory(remoteHistory, remoteEntry.lastModTime);
                  }
                  /**
                   * Merge entry history with remote entry history
                   * Tombstones are stored locally and must be immediately discarded by replica after successful upstream push.
                   * It's client responsibility, to save and load tombstones for local replica, and to clear them after successful upstream push.
                   *
                   * Implements remove-win OR-set CRDT with local tombstones stored in _editState.
                   *
                   * Format doesn't allow saving tombstones for history entries, so they are stored locally.
                   * Any unmodified state from past or modifications of current state synced with central upstream will be successfully merged.
                   * Assumes there's only one central upstream, may produce inconsistencies while merging outdated replica outside main upstream.
                   * Phantom entries and phantom deletions will appear if remote replica checked out an old state and has just added a new state.
                   * If a client is using central upstream for sync, the remote replica must first sync it state and
                   * only after it update the upstream, so this should never happen.
                   *
                   * References:
                   *
                   * An Optimized Conflict-free Replicated Set arXiv:1210.3368 [cs.DC]
                   * http://arxiv.org/abs/1210.3368
                   *
                   * Gene T. J. Wuu and Arthur J. Bernstein. Efficient solutions to the replicated log and dictionary
                   * problems. In Symp. on Principles of Dist. Comp. (PODC), pages 233–242, Vancouver, BC, Canada, August 1984.
                   * https://pages.lip6.fr/Marc.Shapiro/papers/RR-7687.pdf
                   */
                  mergeHistory(remoteHistory, remoteLastModTime) {
                    this.history.sort((x, y) => x.lastModTime - y.lastModTime);
                    remoteHistory.sort((x, y) => x.lastModTime - y.lastModTime);
                    let historyIx = 0, remoteHistoryIx = 0;
                    const newHistory = [];
                    while (historyIx < this.history.length || remoteHistoryIx < remoteHistory.length) {
                      const historyEntry = this.history[historyIx], remoteHistoryEntry = remoteHistory[remoteHistoryIx], entryTime = historyEntry && historyEntry.lastModTime, remoteEntryTime = remoteHistoryEntry && remoteHistoryEntry.lastModTime;
                      if (entryTime === remoteEntryTime) {
                        newHistory.push(historyEntry);
                        historyIx++;
                        remoteHistoryIx++;
                        continue;
                      }
                      if (!historyEntry || entryTime > remoteEntryTime) {
                        if (!this._editState || this._editState.deleted.indexOf(remoteEntryTime) < 0) {
                          const remoteHistoryEntryClone = new KdbxEntry();
                          remoteHistoryEntryClone.copyFrom(remoteHistoryEntry);
                          newHistory.push(remoteHistoryEntryClone);
                        }
                        remoteHistoryIx++;
                        continue;
                      }
                      if (this._editState && this._editState.added.indexOf(entryTime) >= 0) {
                        newHistory.push(historyEntry);
                      } else if (entryTime > remoteLastModTime) {
                        newHistory.push(historyEntry);
                      }
                      historyIx++;
                    }
                    return newHistory;
                  }
                  static create(meta, parentGroup) {
                    const entry = new KdbxEntry();
                    entry.uuid = kdbx_uuid_1.KdbxUuid.random();
                    entry.icon = consts_1.Icons.Key;
                    entry.times = kdbx_times_1.KdbxTimes.create();
                    entry.parentGroup = parentGroup;
                    entry.setField("Title", "", meta.memoryProtection.title);
                    entry.setField("UserName", meta.defaultUser || "", meta.memoryProtection.userName);
                    entry.setField("Password", "", meta.memoryProtection.password);
                    entry.setField("URL", "", meta.memoryProtection.url);
                    entry.setField("Notes", "", meta.memoryProtection.notes);
                    entry.autoType.enabled = typeof parentGroup.enableAutoType === "boolean" ? parentGroup.enableAutoType : true;
                    entry.autoType.obfuscation = consts_1.AutoTypeObfuscationOptions.None;
                    return entry;
                  }
                  static read(xmlNode, ctx, parentGroup) {
                    const entry = new KdbxEntry();
                    for (let i = 0, cn = xmlNode.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName) {
                        entry.readNode(childNode, ctx);
                      }
                    }
                    if (entry.uuid.empty) {
                      entry.uuid = kdbx_uuid_1.KdbxUuid.random();
                      for (let j = 0; j < entry.history.length; j++) {
                        entry.history[j].uuid = entry.uuid;
                      }
                    }
                    entry.parentGroup = parentGroup;
                    return entry;
                  }
                }
                exports2.KdbxEntry = KdbxEntry;
              })
            ),
            /***/
            "./format/kdbx-format.ts": (
              /*!*******************************!*\
                !*** ./format/kdbx-format.ts ***!
                \*******************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxFormat = void 0;
                const fflate_1 = __webpack_require__2(
                  /*! fflate */
                  "../node_modules/fflate/lib/index.cjs"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const binary_stream_1 = __webpack_require__2(
                  /*! ../utils/binary-stream */
                  "./utils/binary-stream.ts"
                );
                const kdbx_context_1 = __webpack_require__2(
                  /*! ./kdbx-context */
                  "./format/kdbx-context.ts"
                );
                const kdbx_header_1 = __webpack_require__2(
                  /*! ./kdbx-header */
                  "./format/kdbx-header.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const protect_salt_generator_1 = __webpack_require__2(
                  /*! ../crypto/protect-salt-generator */
                  "./crypto/protect-salt-generator.ts"
                );
                const XmlUtils = __webpack_require__2(
                  /*! ../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const HmacBlockTransform = __webpack_require__2(
                  /*! ../crypto/hmac-block-transform */
                  "./crypto/hmac-block-transform.ts"
                );
                const HashedBlockTransform = __webpack_require__2(
                  /*! ../crypto/hashed-block-transform */
                  "./crypto/hashed-block-transform.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const KeyEncryptorAes = __webpack_require__2(
                  /*! ../crypto/key-encryptor-aes */
                  "./crypto/key-encryptor-aes.ts"
                );
                const KeyEncryptorKdf = __webpack_require__2(
                  /*! ../crypto/key-encryptor-kdf */
                  "./crypto/key-encryptor-kdf.ts"
                );
                const int64_1 = __webpack_require__2(
                  /*! ../utils/int64 */
                  "./utils/int64.ts"
                );
                class KdbxFormat {
                  constructor(kdbx) {
                    this.preserveXml = false;
                    this.kdbx = kdbx;
                    this.ctx = new kdbx_context_1.KdbxContext({ kdbx });
                  }
                  load(data) {
                    const stm = new binary_stream_1.BinaryStream(data);
                    return this.kdbx.credentials.ready.then(() => {
                      this.kdbx.header = kdbx_header_1.KdbxHeader.read(stm, this.ctx);
                      if (this.kdbx.header.versionMajor === 3) {
                        return this.loadV3(stm);
                      } else if (this.kdbx.header.versionMajor === 4) {
                        return this.loadV4(stm);
                      } else {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidVersion, `bad version: ${this.kdbx.versionMajor}`);
                      }
                    });
                  }
                  loadV3(stm) {
                    return this.decryptXmlV3(stm).then((xmlStr) => {
                      this.kdbx.xml = XmlUtils.parse(xmlStr);
                      return this.setProtectedValues().then(() => {
                        return this.kdbx.loadFromXml(this.ctx).then(() => {
                          return this.checkHeaderHashV3(stm).then(() => {
                            this.cleanXml();
                            return this.kdbx;
                          });
                        });
                      });
                    });
                  }
                  loadV4(stm) {
                    return this.getHeaderHash(stm).then((headerSha) => {
                      const expectedHeaderSha = stm.readBytes(headerSha.byteLength);
                      if (!(0, byte_utils_1.arrayBufferEquals)(expectedHeaderSha, headerSha)) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "header hash mismatch");
                      }
                      return this.computeKeysV4().then((keys) => {
                        return this.getHeaderHmac(stm, keys.hmacKey).then((headerHmac) => {
                          const expectedHeaderHmac = stm.readBytes(headerHmac.byteLength);
                          if (!(0, byte_utils_1.arrayBufferEquals)(expectedHeaderHmac, headerHmac)) {
                            throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidKey);
                          }
                          return HmacBlockTransform.decrypt(stm.readBytesToEnd(), keys.hmacKey).then((data) => {
                            (0, byte_utils_1.zeroBuffer)(keys.hmacKey);
                            return this.decryptData(data, keys.cipherKey).then((data2) => {
                              (0, byte_utils_1.zeroBuffer)(keys.cipherKey);
                              if (this.kdbx.header.compression === consts_1.CompressionAlgorithm.GZip) {
                                data2 = (0, byte_utils_1.arrayToBuffer)((0, fflate_1.gunzipSync)(new Uint8Array(data2)));
                              }
                              stm = new binary_stream_1.BinaryStream((0, byte_utils_1.arrayToBuffer)(data2));
                              this.kdbx.header.readInnerHeader(stm, this.ctx);
                              data2 = stm.readBytesToEnd();
                              const xmlStr = (0, byte_utils_1.bytesToString)(data2);
                              this.kdbx.xml = XmlUtils.parse(xmlStr);
                              return this.setProtectedValues().then(() => {
                                return this.kdbx.loadFromXml(this.ctx).then((kdbx) => {
                                  this.cleanXml();
                                  return kdbx;
                                });
                              });
                            });
                          });
                        });
                      });
                    });
                  }
                  loadXml(xmlStr) {
                    return this.kdbx.credentials.ready.then(() => {
                      this.kdbx.header = kdbx_header_1.KdbxHeader.create();
                      this.kdbx.xml = XmlUtils.parse(xmlStr);
                      XmlUtils.protectPlainValues(this.kdbx.xml.documentElement);
                      return this.kdbx.loadFromXml(this.ctx).then(() => {
                        this.cleanXml();
                        return this.kdbx;
                      });
                    });
                  }
                  save() {
                    return this.kdbx.credentials.ready.then(() => {
                      const stm = new binary_stream_1.BinaryStream();
                      this.kdbx.header.generateSalts();
                      this.kdbx.header.write(stm);
                      if (this.kdbx.versionMajor === 3) {
                        return this.saveV3(stm);
                      } else if (this.kdbx.versionMajor === 4) {
                        return this.saveV4(stm);
                      } else {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidVersion, `bad version: ${this.kdbx.versionMajor}`);
                      }
                    });
                  }
                  saveV3(stm) {
                    return this.getHeaderHash(stm).then((headerHash) => {
                      this.kdbx.meta.headerHash = headerHash;
                      this.kdbx.buildXml(this.ctx);
                      return this.getProtectSaltGenerator().then((gen) => {
                        if (!this.kdbx.xml) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no xml");
                        }
                        XmlUtils.updateProtectedValuesSalt(this.kdbx.xml.documentElement, gen);
                        return this.encryptXmlV3().then((data) => {
                          this.cleanXml();
                          stm.writeBytes(data);
                          return stm.getWrittenBytes();
                        });
                      });
                    });
                  }
                  saveV4(stm) {
                    this.kdbx.buildXml(this.ctx);
                    return this.getHeaderHash(stm).then((headerSha) => {
                      stm.writeBytes(headerSha);
                      return this.computeKeysV4().then((keys) => {
                        return this.getHeaderHmac(stm, keys.hmacKey).then((headerHmac) => {
                          stm.writeBytes(headerHmac);
                          return this.getProtectSaltGenerator().then((gen) => {
                            if (!this.kdbx.xml) {
                              throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no xml");
                            }
                            XmlUtils.updateProtectedValuesSalt(this.kdbx.xml.documentElement, gen);
                            const xml = XmlUtils.serialize(this.kdbx.xml);
                            const innerHeaderStm = new binary_stream_1.BinaryStream();
                            this.kdbx.header.writeInnerHeader(innerHeaderStm, this.ctx);
                            const innerHeaderData = innerHeaderStm.getWrittenBytes();
                            const xmlData = (0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.stringToBytes)(xml));
                            let data = new ArrayBuffer(innerHeaderData.byteLength + xmlData.byteLength);
                            const dataArr = new Uint8Array(data);
                            dataArr.set(new Uint8Array(innerHeaderData));
                            dataArr.set(new Uint8Array(xmlData), innerHeaderData.byteLength);
                            (0, byte_utils_1.zeroBuffer)(xmlData);
                            (0, byte_utils_1.zeroBuffer)(innerHeaderData);
                            if (this.kdbx.header.compression === consts_1.CompressionAlgorithm.GZip) {
                              data = (0, byte_utils_1.arrayToBuffer)((0, fflate_1.gzipSync)(new Uint8Array(data)));
                            }
                            return this.encryptData((0, byte_utils_1.arrayToBuffer)(data), keys.cipherKey).then((data2) => {
                              (0, byte_utils_1.zeroBuffer)(keys.cipherKey);
                              return HmacBlockTransform.encrypt(data2, keys.hmacKey).then((data3) => {
                                this.cleanXml();
                                (0, byte_utils_1.zeroBuffer)(keys.hmacKey);
                                stm.writeBytes(data3);
                                return stm.getWrittenBytes();
                              });
                            });
                          });
                        });
                      });
                    });
                  }
                  saveXml(prettyPrint = false) {
                    return this.kdbx.credentials.ready.then(() => {
                      this.kdbx.header.generateSalts();
                      this.ctx.exportXml = true;
                      this.kdbx.buildXml(this.ctx);
                      if (!this.kdbx.xml) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no xml");
                      }
                      XmlUtils.unprotectValues(this.kdbx.xml.documentElement);
                      const xml = XmlUtils.serialize(this.kdbx.xml, prettyPrint);
                      XmlUtils.protectUnprotectedValues(this.kdbx.xml.documentElement);
                      this.cleanXml();
                      return xml;
                    });
                  }
                  decryptXmlV3(stm) {
                    const data = stm.readBytesToEnd();
                    return this.getMasterKeyV3().then((masterKey) => {
                      return this.decryptData(data, masterKey).then((data2) => {
                        (0, byte_utils_1.zeroBuffer)(masterKey);
                        data2 = this.trimStartBytesV3(data2);
                        return HashedBlockTransform.decrypt(data2).then((data3) => {
                          if (this.kdbx.header.compression === consts_1.CompressionAlgorithm.GZip) {
                            data3 = (0, byte_utils_1.arrayToBuffer)((0, fflate_1.gunzipSync)(new Uint8Array(data3)));
                          }
                          return (0, byte_utils_1.bytesToString)(data3);
                        });
                      });
                    });
                  }
                  encryptXmlV3() {
                    if (!this.kdbx.xml) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no xml");
                    }
                    const xml = XmlUtils.serialize(this.kdbx.xml);
                    let data = (0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.stringToBytes)(xml));
                    if (this.kdbx.header.compression === consts_1.CompressionAlgorithm.GZip) {
                      data = (0, byte_utils_1.arrayToBuffer)((0, fflate_1.gzipSync)(new Uint8Array(data)));
                    }
                    return HashedBlockTransform.encrypt((0, byte_utils_1.arrayToBuffer)(data)).then((data2) => {
                      if (!this.kdbx.header.streamStartBytes) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no header start bytes");
                      }
                      const ssb = new Uint8Array(this.kdbx.header.streamStartBytes);
                      const newData = new Uint8Array(data2.byteLength + ssb.length);
                      newData.set(ssb);
                      newData.set(new Uint8Array(data2), ssb.length);
                      data2 = newData;
                      return this.getMasterKeyV3().then((masterKey) => {
                        return this.encryptData((0, byte_utils_1.arrayToBuffer)(data2), masterKey).then((data3) => {
                          (0, byte_utils_1.zeroBuffer)(masterKey);
                          return data3;
                        });
                      });
                    });
                  }
                  getMasterKeyV3() {
                    return this.kdbx.credentials.getHash().then((credHash) => {
                      if (!this.kdbx.header.transformSeed || !this.kdbx.header.keyEncryptionRounds || !this.kdbx.header.masterSeed) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no header transform parameters");
                      }
                      const transformSeed = this.kdbx.header.transformSeed;
                      const transformRounds = this.kdbx.header.keyEncryptionRounds;
                      const masterSeed = this.kdbx.header.masterSeed;
                      return this.kdbx.credentials.getChallengeResponse(masterSeed).then((chalResp) => {
                        return KeyEncryptorAes.encrypt(new Uint8Array(credHash), transformSeed, transformRounds).then((encKey) => {
                          (0, byte_utils_1.zeroBuffer)(credHash);
                          return CryptoEngine.sha256(encKey).then((keyHash) => {
                            (0, byte_utils_1.zeroBuffer)(encKey);
                            const chalRespLength = chalResp ? chalResp.byteLength : 0;
                            const all = new Uint8Array(masterSeed.byteLength + keyHash.byteLength + chalRespLength);
                            all.set(new Uint8Array(masterSeed), 0);
                            if (chalResp) {
                              all.set(new Uint8Array(chalResp), masterSeed.byteLength);
                            }
                            all.set(new Uint8Array(keyHash), masterSeed.byteLength + chalRespLength);
                            (0, byte_utils_1.zeroBuffer)(keyHash);
                            (0, byte_utils_1.zeroBuffer)(masterSeed);
                            if (chalResp) {
                              (0, byte_utils_1.zeroBuffer)(chalResp);
                            }
                            return CryptoEngine.sha256(all.buffer).then((masterKey) => {
                              (0, byte_utils_1.zeroBuffer)(all.buffer);
                              return masterKey;
                            });
                          });
                        });
                      });
                    });
                  }
                  trimStartBytesV3(data) {
                    if (!this.kdbx.header.streamStartBytes) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no stream start bytes");
                    }
                    const ssb = this.kdbx.header.streamStartBytes;
                    if (data.byteLength < ssb.byteLength) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "short start bytes");
                    }
                    if (!(0, byte_utils_1.arrayBufferEquals)(data.slice(0, this.kdbx.header.streamStartBytes.byteLength), ssb)) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidKey);
                    }
                    return data.slice(ssb.byteLength);
                  }
                  setProtectedValues() {
                    return this.getProtectSaltGenerator().then((gen) => {
                      if (!this.kdbx.xml) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no xml");
                      }
                      XmlUtils.setProtectedValues(this.kdbx.xml.documentElement, gen);
                    });
                  }
                  getProtectSaltGenerator() {
                    if (!this.kdbx.header.protectedStreamKey || !this.kdbx.header.crsAlgorithm) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "bad header parameters");
                    }
                    return protect_salt_generator_1.ProtectSaltGenerator.create(this.kdbx.header.protectedStreamKey, this.kdbx.header.crsAlgorithm);
                  }
                  getHeaderHash(stm) {
                    if (!this.kdbx.header.endPos) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no end pos");
                    }
                    const src = stm.readBytesNoAdvance(0, this.kdbx.header.endPos);
                    return CryptoEngine.sha256(src);
                  }
                  getHeaderHmac(stm, key) {
                    if (!this.kdbx.header.endPos) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no end pos");
                    }
                    const src = stm.readBytesNoAdvance(0, this.kdbx.header.endPos);
                    return HmacBlockTransform.getHmacKey(key, new int64_1.Int64(4294967295, 4294967295)).then((keySha) => {
                      return CryptoEngine.hmacSha256(keySha, src);
                    });
                  }
                  checkHeaderHashV3(stm) {
                    if (this.kdbx.meta.headerHash) {
                      const metaHash = this.kdbx.meta.headerHash;
                      return this.getHeaderHash(stm).then((actualHash) => {
                        if (!(0, byte_utils_1.arrayBufferEquals)(metaHash, actualHash)) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "header hash mismatch");
                        }
                      });
                    } else {
                      return Promise.resolve();
                    }
                  }
                  computeKeysV4() {
                    const masterSeed = this.kdbx.header.masterSeed;
                    if (!masterSeed || masterSeed.byteLength !== 32) {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad master seed"));
                    }
                    const kdfParams = this.kdbx.header.kdfParameters;
                    if (!kdfParams) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no kdf params");
                    }
                    const kdfSalt = kdfParams.get("S");
                    if (!(kdfSalt instanceof ArrayBuffer)) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no salt");
                    }
                    return this.kdbx.credentials.getHash(kdfSalt).then((credHash) => {
                      return KeyEncryptorKdf.encrypt(credHash, kdfParams).then((encKey) => {
                        (0, byte_utils_1.zeroBuffer)(credHash);
                        if (!encKey || encKey.byteLength !== 32) {
                          return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "bad derived key"));
                        }
                        const keyWithSeed = new Uint8Array(65);
                        keyWithSeed.set(new Uint8Array(masterSeed), 0);
                        keyWithSeed.set(new Uint8Array(encKey), masterSeed.byteLength);
                        keyWithSeed[64] = 1;
                        (0, byte_utils_1.zeroBuffer)(encKey);
                        (0, byte_utils_1.zeroBuffer)(masterSeed);
                        return Promise.all([
                          CryptoEngine.sha256(keyWithSeed.buffer.slice(0, 64)),
                          CryptoEngine.sha512(keyWithSeed.buffer)
                        ]).then((keys) => {
                          (0, byte_utils_1.zeroBuffer)(keyWithSeed);
                          return { cipherKey: keys[0], hmacKey: keys[1] };
                        });
                      });
                    });
                  }
                  decryptData(data, cipherKey) {
                    const cipherId = this.kdbx.header.dataCipherUuid;
                    if (!cipherId) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no cipher id");
                    }
                    switch (cipherId.toString()) {
                      case consts_1.CipherId.Aes:
                        return this.transformDataV4Aes(data, cipherKey, false);
                      case consts_1.CipherId.ChaCha20:
                        return this.transformDataV4ChaCha20(data, cipherKey);
                      default:
                        return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "unsupported cipher"));
                    }
                  }
                  encryptData(data, cipherKey) {
                    const cipherId = this.kdbx.header.dataCipherUuid;
                    if (!cipherId) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no cipher id");
                    }
                    switch (cipherId.toString()) {
                      case consts_1.CipherId.Aes:
                        return this.transformDataV4Aes(data, cipherKey, true);
                      case consts_1.CipherId.ChaCha20:
                        return this.transformDataV4ChaCha20(data, cipherKey);
                      default:
                        return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "unsupported cipher"));
                    }
                  }
                  transformDataV4Aes(data, cipherKey, encrypt) {
                    const aesCbc = CryptoEngine.createAesCbc();
                    const iv = this.kdbx.header.encryptionIV;
                    if (!iv) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no encryption IV");
                    }
                    return aesCbc.importKey(cipherKey).then(() => {
                      return encrypt ? aesCbc.encrypt(data, iv) : aesCbc.decrypt(data, iv);
                    });
                  }
                  transformDataV4ChaCha20(data, cipherKey) {
                    const iv = this.kdbx.header.encryptionIV;
                    if (!iv) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no encryption IV");
                    }
                    return CryptoEngine.chacha20(data, cipherKey, iv);
                  }
                  cleanXml() {
                    if (!this.preserveXml) {
                      this.kdbx.xml = void 0;
                    }
                  }
                }
                exports2.KdbxFormat = KdbxFormat;
              })
            ),
            /***/
            "./format/kdbx-group.ts": (
              /*!******************************!*\
                !*** ./format/kdbx-group.ts ***!
                \******************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxGroup = void 0;
                const XmlNames = __webpack_require__2(
                  /*! ./../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                const XmlUtils = __webpack_require__2(
                  /*! ./../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const kdbx_times_1 = __webpack_require__2(
                  /*! ./kdbx-times */
                  "./format/kdbx-times.ts"
                );
                const kdbx_uuid_1 = __webpack_require__2(
                  /*! ./kdbx-uuid */
                  "./format/kdbx-uuid.ts"
                );
                const kdbx_entry_1 = __webpack_require__2(
                  /*! ./kdbx-entry */
                  "./format/kdbx-entry.ts"
                );
                const kdbx_custom_data_1 = __webpack_require__2(
                  /*! ./kdbx-custom-data */
                  "./format/kdbx-custom-data.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                class KdbxGroup {
                  constructor() {
                    this.uuid = new kdbx_uuid_1.KdbxUuid();
                    this.tags = [];
                    this.times = new kdbx_times_1.KdbxTimes();
                    this.groups = [];
                    this.entries = [];
                  }
                  get lastModTime() {
                    var _a, _b;
                    return (_b = (_a = this.times.lastModTime) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0;
                  }
                  get locationChanged() {
                    var _a, _b;
                    return (_b = (_a = this.times.locationChanged) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0;
                  }
                  readNode(node, ctx) {
                    var _a, _b;
                    switch (node.tagName) {
                      case XmlNames.Elem.Uuid:
                        this.uuid = (_a = XmlUtils.getUuid(node)) !== null && _a !== void 0 ? _a : new kdbx_uuid_1.KdbxUuid();
                        break;
                      case XmlNames.Elem.Name:
                        this.name = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.Notes:
                        this.notes = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.Icon:
                        this.icon = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.CustomIconID:
                        this.customIcon = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.Tags:
                        this.tags = XmlUtils.getTags(node);
                        break;
                      case XmlNames.Elem.Times:
                        this.times = kdbx_times_1.KdbxTimes.read(node);
                        break;
                      case XmlNames.Elem.IsExpanded:
                        this.expanded = (_b = XmlUtils.getBoolean(node)) !== null && _b !== void 0 ? _b : void 0;
                        break;
                      case XmlNames.Elem.GroupDefaultAutoTypeSeq:
                        this.defaultAutoTypeSeq = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.EnableAutoType:
                        this.enableAutoType = XmlUtils.getBoolean(node);
                        break;
                      case XmlNames.Elem.EnableSearching:
                        this.enableSearching = XmlUtils.getBoolean(node);
                        break;
                      case XmlNames.Elem.LastTopVisibleEntry:
                        this.lastTopVisibleEntry = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.Group:
                        this.groups.push(KdbxGroup.read(node, ctx, this));
                        break;
                      case XmlNames.Elem.Entry:
                        this.entries.push(kdbx_entry_1.KdbxEntry.read(node, ctx, this));
                        break;
                      case XmlNames.Elem.CustomData:
                        this.customData = kdbx_custom_data_1.KdbxCustomData.read(node);
                        break;
                      case XmlNames.Elem.PreviousParentGroup:
                        this.previousParentGroup = XmlUtils.getUuid(node);
                        break;
                    }
                  }
                  write(parentNode, ctx) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.Group);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.Uuid), this.uuid);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.Name), this.name);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.Notes), this.notes);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.Icon), this.icon);
                    if (this.tags.length && ctx.kdbx.versionIsAtLeast(4, 1)) {
                      XmlUtils.setTags(XmlUtils.addChildNode(node, XmlNames.Elem.Tags), this.tags);
                    }
                    if (this.customIcon) {
                      XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.CustomIconID), this.customIcon);
                    }
                    if (this.previousParentGroup !== void 0 && ctx.kdbx.versionIsAtLeast(4, 1)) {
                      XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.PreviousParentGroup), this.previousParentGroup);
                    }
                    if (this.customData) {
                      kdbx_custom_data_1.KdbxCustomData.write(node, ctx, this.customData);
                    }
                    this.times.write(node, ctx);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.IsExpanded), this.expanded);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.GroupDefaultAutoTypeSeq), this.defaultAutoTypeSeq);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.EnableAutoType), this.enableAutoType);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.EnableSearching), this.enableSearching);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.LastTopVisibleEntry), this.lastTopVisibleEntry);
                    for (const group of this.groups) {
                      group.write(node, ctx);
                    }
                    for (const entry of this.entries) {
                      entry.write(node, ctx);
                    }
                  }
                  *allGroups() {
                    yield this;
                    for (const group of this.groups) {
                      for (const g of group.allGroups()) {
                        yield g;
                      }
                    }
                  }
                  *allEntries() {
                    for (const group of this.allGroups()) {
                      for (const entry of group.entries) {
                        yield entry;
                      }
                    }
                  }
                  *allGroupsAndEntries() {
                    yield this;
                    for (const entry of this.entries) {
                      yield entry;
                    }
                    for (const group of this.groups) {
                      for (const item of group.allGroupsAndEntries()) {
                        yield item;
                      }
                    }
                  }
                  merge(objectMap) {
                    const remoteGroup = objectMap.remoteGroups.get(this.uuid.id);
                    if (!remoteGroup) {
                      return;
                    }
                    if (remoteGroup.lastModTime > this.lastModTime) {
                      this.copyFrom(remoteGroup);
                    }
                    this.groups = this.mergeCollection(this.groups, remoteGroup.groups, objectMap.groups, objectMap.remoteGroups, objectMap.deleted);
                    this.entries = this.mergeCollection(this.entries, remoteGroup.entries, objectMap.entries, objectMap.remoteEntries, objectMap.deleted);
                    for (const group of this.groups) {
                      group.merge(objectMap);
                    }
                    for (const entry of this.entries) {
                      entry.merge(objectMap);
                    }
                  }
                  /**
                   * Merge object collection with remote collection
                   * Implements 2P-set CRDT with tombstones stored in objectMap.deleted
                   * Assumes tombstones are already merged
                   */
                  mergeCollection(collection, remoteCollection, objectMapItems, remoteObjectMapItems, deletedObjects) {
                    const newItems = [];
                    for (const item of collection) {
                      if (!item.uuid || deletedObjects.has(item.uuid.id)) {
                        continue;
                      }
                      const remoteItem = remoteObjectMapItems.get(item.uuid.id);
                      if (!remoteItem) {
                        newItems.push(item);
                      } else if (remoteItem.locationChanged <= item.locationChanged) {
                        newItems.push(item);
                      }
                    }
                    let ix = -1;
                    for (const remoteItem of remoteCollection) {
                      ix++;
                      if (!remoteItem.uuid || deletedObjects.has(remoteItem.uuid.id)) {
                        continue;
                      }
                      const item = objectMapItems.get(remoteItem.uuid.id);
                      if (item && remoteItem.locationChanged > item.locationChanged) {
                        item.parentGroup = this;
                        newItems.splice(KdbxGroup.findInsertIx(newItems, remoteCollection, ix), 0, item);
                      } else if (!item) {
                        let newItem;
                        if (remoteItem instanceof KdbxGroup) {
                          const group = new KdbxGroup();
                          group.copyFrom(remoteItem);
                          newItem = group;
                        } else if (remoteItem instanceof kdbx_entry_1.KdbxEntry) {
                          const entry = new kdbx_entry_1.KdbxEntry();
                          entry.copyFrom(remoteItem);
                          newItem = entry;
                        } else {
                          continue;
                        }
                        newItem.parentGroup = this;
                        newItems.splice(KdbxGroup.findInsertIx(newItems, remoteCollection, ix), 0, newItem);
                      }
                    }
                    return newItems;
                  }
                  /**
                   * Finds a best place to insert new item into collection
                   */
                  static findInsertIx(dst, src, srcIx) {
                    let selectedIx = dst.length, selectedScore = -1;
                    for (let dstIx = 0; dstIx <= dst.length; dstIx++) {
                      let score = 0;
                      const srcPrev = srcIx > 0 ? src[srcIx - 1].uuid.id : void 0, srcNext = srcIx + 1 < src.length ? src[srcIx + 1].uuid.id : void 0, dstPrev = dstIx > 0 ? dst[dstIx - 1].uuid.id : void 0, dstNext = dstIx < dst.length ? dst[dstIx].uuid.id : void 0;
                      if (!srcPrev && !dstPrev) {
                        score += 1;
                      } else if (srcPrev === dstPrev) {
                        score += 5;
                      }
                      if (!srcNext && !dstNext) {
                        score += 2;
                      } else if (srcNext === dstNext) {
                        score += 5;
                      }
                      if (score > selectedScore) {
                        selectedIx = dstIx;
                        selectedScore = score;
                      }
                    }
                    return selectedIx;
                  }
                  copyFrom(group) {
                    this.uuid = group.uuid;
                    this.name = group.name;
                    this.notes = group.notes;
                    this.icon = group.icon;
                    this.customIcon = group.customIcon;
                    this.times = group.times.clone();
                    this.expanded = group.expanded;
                    this.defaultAutoTypeSeq = group.defaultAutoTypeSeq;
                    this.enableAutoType = group.enableAutoType;
                    this.enableSearching = group.enableSearching;
                    this.lastTopVisibleEntry = group.lastTopVisibleEntry;
                  }
                  static create(name, parentGroup) {
                    const group = new KdbxGroup();
                    group.uuid = kdbx_uuid_1.KdbxUuid.random();
                    group.icon = consts_1.Icons.Folder;
                    group.times = kdbx_times_1.KdbxTimes.create();
                    group.name = name;
                    group.parentGroup = parentGroup;
                    group.expanded = true;
                    group.enableAutoType = null;
                    group.enableSearching = null;
                    group.lastTopVisibleEntry = new kdbx_uuid_1.KdbxUuid();
                    return group;
                  }
                  static read(xmlNode, ctx, parentGroup) {
                    const grp = new KdbxGroup();
                    for (let i = 0, cn = xmlNode.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName) {
                        grp.readNode(childNode, ctx);
                      }
                    }
                    if (grp.uuid.empty) {
                      grp.uuid = kdbx_uuid_1.KdbxUuid.random();
                    }
                    grp.parentGroup = parentGroup;
                    return grp;
                  }
                }
                exports2.KdbxGroup = KdbxGroup;
              })
            ),
            /***/
            "./format/kdbx-header.ts": (
              /*!*******************************!*\
                !*** ./format/kdbx-header.ts ***!
                \*******************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxHeader = void 0;
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const kdbx_uuid_1 = __webpack_require__2(
                  /*! ./kdbx-uuid */
                  "./format/kdbx-uuid.ts"
                );
                const var_dictionary_1 = __webpack_require__2(
                  /*! ../utils/var-dictionary */
                  "./utils/var-dictionary.ts"
                );
                const binary_stream_1 = __webpack_require__2(
                  /*! ../utils/binary-stream */
                  "./utils/binary-stream.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const int64_1 = __webpack_require__2(
                  /*! ../utils/int64 */
                  "./utils/int64.ts"
                );
                const protected_value_1 = __webpack_require__2(
                  /*! ../crypto/protected-value */
                  "./crypto/protected-value.ts"
                );
                const HeaderFields = [
                  { name: "EndOfHeader" },
                  { name: "Comment" },
                  { name: "CipherID" },
                  { name: "CompressionFlags" },
                  { name: "MasterSeed" },
                  { name: "TransformSeed", ver: [3] },
                  { name: "TransformRounds", ver: [3] },
                  { name: "EncryptionIV" },
                  { name: "ProtectedStreamKey", ver: [3] },
                  { name: "StreamStartBytes", ver: [3] },
                  { name: "InnerRandomStreamID", ver: [3] },
                  { name: "KdfParameters", ver: [4] },
                  { name: "PublicCustomData", ver: [4] }
                ];
                const InnerHeaderFields = [
                  { name: "EndOfHeader" },
                  { name: "InnerRandomStreamID" },
                  { name: "InnerRandomStreamKey" },
                  { name: "Binary", skipHeader: true }
                ];
                const HeaderConst = {
                  DefaultFileVersionMajor: 4,
                  MinSupportedVersion: 3,
                  MaxSupportedVersion: 4,
                  FlagBinaryProtected: 1,
                  InnerHeaderBinaryFieldId: 3,
                  DefaultKdfAlgo: consts_1.KdfId.Argon2d,
                  DefaultKdfSaltLength: 32,
                  DefaultKdfParallelism: 1,
                  DefaultKdfIterations: 2,
                  DefaultKdfMemory: 1024 * 1024,
                  DefaultKdfVersion: 19,
                  EndOfHeader: 13675786
                };
                const DefaultMinorVersions = {
                  3: 1,
                  4: 0
                };
                const LastMinorVersions = {
                  3: 1,
                  4: 1
                };
                class KdbxHeader {
                  constructor() {
                    this.versionMajor = 0;
                    this.versionMinor = 0;
                  }
                  readSignature(stm) {
                    if (stm.byteLength < 8) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "not enough data");
                    }
                    const sig1 = stm.getUint32(true), sig2 = stm.getUint32(true);
                    if (!(sig1 === consts_1.Signatures.FileMagic && sig2 === consts_1.Signatures.Sig2Kdbx)) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.BadSignature);
                    }
                  }
                  writeSignature(stm) {
                    stm.setUint32(consts_1.Signatures.FileMagic, true);
                    stm.setUint32(consts_1.Signatures.Sig2Kdbx, true);
                  }
                  readVersion(stm) {
                    const versionMinor = stm.getUint16(true);
                    const versionMajor = stm.getUint16(true);
                    if (versionMajor > HeaderConst.MaxSupportedVersion || versionMajor < HeaderConst.MinSupportedVersion) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidVersion);
                    }
                    if (versionMinor > LastMinorVersions[versionMajor]) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidVersion);
                    }
                    this.versionMinor = versionMinor;
                    this.versionMajor = versionMajor;
                  }
                  writeVersion(stm) {
                    if (!this.versionMajor) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "version is not set");
                    }
                    stm.setUint16(this.versionMinor, true);
                    stm.setUint16(this.versionMajor, true);
                  }
                  readCipherID(bytes) {
                    if (bytes.byteLength !== 16) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "cipher");
                    }
                    this.dataCipherUuid = new kdbx_uuid_1.KdbxUuid(bytes);
                  }
                  writeCipherID(stm) {
                    if (!this.dataCipherUuid) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "cipher id is not set");
                    }
                    this.writeFieldSize(stm, 16);
                    stm.writeBytes(this.dataCipherUuid.bytes);
                  }
                  readCompressionFlags(bytes) {
                    const id = new DataView(bytes).getUint32(0, true);
                    if (id < 0 || id >= Object.keys(consts_1.CompressionAlgorithm).length) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported, "compression");
                    }
                    this.compression = id;
                  }
                  writeCompressionFlags(stm) {
                    if (typeof this.compression !== "number") {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "compression is not set");
                    }
                    this.writeFieldSize(stm, 4);
                    stm.setUint32(this.compression, true);
                  }
                  readMasterSeed(bytes) {
                    this.masterSeed = bytes;
                  }
                  writeMasterSeed(stm) {
                    if (!this.masterSeed) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "master seed is not set");
                    }
                    this.writeFieldBytes(stm, this.masterSeed);
                  }
                  readTransformSeed(bytes) {
                    this.transformSeed = bytes;
                  }
                  writeTransformSeed(stm) {
                    if (!this.transformSeed) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "transform seed is not set");
                    }
                    this.writeFieldBytes(stm, this.transformSeed);
                  }
                  readTransformRounds(bytes) {
                    this.keyEncryptionRounds = new binary_stream_1.BinaryStream(bytes).getUint64(true);
                  }
                  writeTransformRounds(stm) {
                    if (!this.keyEncryptionRounds) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "key encryption rounds is not set");
                    }
                    this.writeFieldSize(stm, 8);
                    stm.setUint64(this.keyEncryptionRounds, true);
                  }
                  readEncryptionIV(bytes) {
                    this.encryptionIV = bytes;
                  }
                  writeEncryptionIV(stm) {
                    if (!this.encryptionIV) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "encryption IV is not set");
                    }
                    this.writeFieldBytes(stm, this.encryptionIV);
                  }
                  readProtectedStreamKey(bytes) {
                    this.protectedStreamKey = bytes;
                  }
                  writeProtectedStreamKey(stm) {
                    if (!this.protectedStreamKey) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "protected stream key is not set");
                    }
                    this.writeFieldBytes(stm, this.protectedStreamKey);
                  }
                  readStreamStartBytes(bytes) {
                    this.streamStartBytes = bytes;
                  }
                  writeStreamStartBytes(stm) {
                    if (!this.streamStartBytes) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "stream start bytes is not set");
                    }
                    this.writeFieldBytes(stm, this.streamStartBytes);
                  }
                  readInnerRandomStreamID(bytes) {
                    this.crsAlgorithm = new DataView(bytes).getUint32(0, true);
                  }
                  writeInnerRandomStreamID(stm) {
                    if (!this.crsAlgorithm) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "CRSAlgorithm is not set");
                    }
                    this.writeFieldSize(stm, 4);
                    stm.setUint32(this.crsAlgorithm, true);
                  }
                  readInnerRandomStreamKey(bytes) {
                    this.protectedStreamKey = bytes;
                  }
                  writeInnerRandomStreamKey(stm) {
                    if (!this.protectedStreamKey) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "protected stream key is not set");
                    }
                    this.writeFieldBytes(stm, this.protectedStreamKey);
                  }
                  readKdfParameters(bytes) {
                    this.kdfParameters = var_dictionary_1.VarDictionary.read(new binary_stream_1.BinaryStream(bytes));
                  }
                  writeKdfParameters(stm) {
                    if (!this.kdfParameters) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "KDF parameters are not set");
                    }
                    const innerStream = new binary_stream_1.BinaryStream();
                    this.kdfParameters.write(innerStream);
                    this.writeFieldBytes(stm, innerStream.getWrittenBytes());
                  }
                  readPublicCustomData(bytes) {
                    this.publicCustomData = var_dictionary_1.VarDictionary.read(new binary_stream_1.BinaryStream(bytes));
                  }
                  hasPublicCustomData() {
                    return !!this.publicCustomData;
                  }
                  writePublicCustomData(stm) {
                    if (this.publicCustomData) {
                      const innerStream = new binary_stream_1.BinaryStream();
                      this.publicCustomData.write(innerStream);
                      this.writeFieldBytes(stm, innerStream.getWrittenBytes());
                    }
                  }
                  readBinary(bytes, ctx) {
                    const view = new DataView(bytes);
                    const flags = view.getUint8(0);
                    const isProtected = flags & HeaderConst.FlagBinaryProtected;
                    const binaryData = bytes.slice(1);
                    const binary = isProtected ? protected_value_1.ProtectedValue.fromBinary(binaryData) : binaryData;
                    ctx.kdbx.binaries.addWithNextId(binary);
                  }
                  writeBinary(stm, ctx) {
                    if (this.versionMajor < 4) {
                      return;
                    }
                    const binaries = ctx.kdbx.binaries.getAll();
                    for (const binary of binaries) {
                      stm.setUint8(HeaderConst.InnerHeaderBinaryFieldId);
                      if (binary.value instanceof protected_value_1.ProtectedValue) {
                        const binaryData = binary.value.getBinary();
                        this.writeFieldSize(stm, binaryData.byteLength + 1);
                        stm.setUint8(HeaderConst.FlagBinaryProtected);
                        stm.writeBytes(binaryData);
                        (0, byte_utils_1.zeroBuffer)(binaryData);
                      } else {
                        this.writeFieldSize(stm, binary.value.byteLength + 1);
                        stm.setUint8(0);
                        stm.writeBytes(binary.value);
                      }
                    }
                  }
                  writeEndOfHeader(stm) {
                    this.writeFieldSize(stm, 4);
                    stm.setUint32(HeaderConst.EndOfHeader, false);
                  }
                  readField(stm, fields, ctx) {
                    const headerId = stm.getUint8();
                    const size = this.readFieldSize(stm);
                    const bytes = size > 0 ? stm.readBytes(size) : new ArrayBuffer(0);
                    const headerField = fields[headerId];
                    switch (headerField.name) {
                      case "EndOfHeader":
                      case "Comment":
                        break;
                      case "CipherID":
                        this.readCipherID(bytes);
                        break;
                      case "CompressionFlags":
                        this.readCompressionFlags(bytes);
                        break;
                      case "MasterSeed":
                        this.readMasterSeed(bytes);
                        break;
                      case "TransformSeed":
                        this.readTransformSeed(bytes);
                        break;
                      case "TransformRounds":
                        this.readTransformRounds(bytes);
                        break;
                      case "EncryptionIV":
                        this.readEncryptionIV(bytes);
                        break;
                      case "ProtectedStreamKey":
                        this.readProtectedStreamKey(bytes);
                        break;
                      case "StreamStartBytes":
                        this.readStreamStartBytes(bytes);
                        break;
                      case "InnerRandomStreamID":
                        this.readInnerRandomStreamID(bytes);
                        break;
                      case "KdfParameters":
                        this.readKdfParameters(bytes);
                        break;
                      case "PublicCustomData":
                        this.readPublicCustomData(bytes);
                        break;
                      case "InnerRandomStreamKey":
                        this.readInnerRandomStreamKey(bytes);
                        break;
                      case "Binary":
                        this.readBinary(bytes, ctx);
                        break;
                      default:
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, `bad header field: ${headerField.name}`);
                    }
                    return headerId !== 0;
                  }
                  writeField(stm, headerId, fields, ctx) {
                    const headerField = fields[headerId];
                    if (headerField) {
                      if (headerField.ver && !headerField.ver.includes(this.versionMajor)) {
                        return;
                      }
                      switch (headerField.name) {
                        case "PublicCustomData":
                          if (!this.hasPublicCustomData()) {
                            return;
                          }
                          break;
                        case "Comment":
                          return;
                      }
                      if (!headerField.skipHeader) {
                        stm.setUint8(headerId);
                      }
                      switch (headerField.name) {
                        case "EndOfHeader":
                          this.writeEndOfHeader(stm);
                          break;
                        case "CipherID":
                          this.writeCipherID(stm);
                          break;
                        case "CompressionFlags":
                          this.writeCompressionFlags(stm);
                          break;
                        case "MasterSeed":
                          this.writeMasterSeed(stm);
                          break;
                        case "TransformSeed":
                          this.writeTransformSeed(stm);
                          break;
                        case "TransformRounds":
                          this.writeTransformRounds(stm);
                          break;
                        case "EncryptionIV":
                          this.writeEncryptionIV(stm);
                          break;
                        case "ProtectedStreamKey":
                          this.writeProtectedStreamKey(stm);
                          break;
                        case "StreamStartBytes":
                          this.writeStreamStartBytes(stm);
                          break;
                        case "InnerRandomStreamID":
                          this.writeInnerRandomStreamID(stm);
                          break;
                        case "KdfParameters":
                          this.writeKdfParameters(stm);
                          break;
                        case "PublicCustomData":
                          this.writePublicCustomData(stm);
                          break;
                        case "InnerRandomStreamKey":
                          this.writeInnerRandomStreamKey(stm);
                          break;
                        case "Binary":
                          if (!ctx) {
                            throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "context is not set");
                          }
                          this.writeBinary(stm, ctx);
                          break;
                        default:
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, `Bad header field: ${headerField.name}`);
                      }
                    }
                  }
                  readFieldSize(stm) {
                    return (this.versionMajor | 0) >= 4 ? stm.getUint32(true) : stm.getUint16(true);
                  }
                  writeFieldSize(stm, size) {
                    if ((this.versionMajor | 0) >= 4) {
                      stm.setUint32(size, true);
                    } else {
                      stm.setUint16(size, true);
                    }
                  }
                  writeFieldBytes(stm, bytes) {
                    this.writeFieldSize(stm, bytes.byteLength);
                    stm.writeBytes(bytes);
                  }
                  validate() {
                    if (!this.versionMajor || this.versionMinor === void 0) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no version in header");
                    }
                    if (this.dataCipherUuid === void 0) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no cipher in header");
                    }
                    if (this.compression === void 0) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no compression in header");
                    }
                    if (!this.masterSeed) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no master seed in header");
                    }
                    if (this.versionMajor < 4 && !this.transformSeed) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no transform seed in header");
                    }
                    if (this.versionMajor < 4 && !this.keyEncryptionRounds) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no key encryption rounds in header");
                    }
                    if (!this.encryptionIV) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no encryption iv in header");
                    }
                    if (this.versionMajor < 4 && !this.protectedStreamKey) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no protected stream key in header");
                    }
                    if (this.versionMajor < 4 && !this.streamStartBytes) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no stream start bytes in header");
                    }
                    if (this.versionMajor < 4 && !this.crsAlgorithm) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no crs algorithm in header");
                    }
                    if (this.versionMajor >= 4 && !this.kdfParameters) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no kdf parameters in header");
                    }
                  }
                  validateInner() {
                    if (!this.protectedStreamKey) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no protected stream key in header");
                    }
                    if (!this.crsAlgorithm) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "no crs algorithm in header");
                    }
                  }
                  createKdfParameters(algo) {
                    if (!algo) {
                      algo = HeaderConst.DefaultKdfAlgo;
                    }
                    switch (algo) {
                      case consts_1.KdfId.Argon2d:
                      case consts_1.KdfId.Argon2id:
                        this.kdfParameters = new var_dictionary_1.VarDictionary();
                        this.kdfParameters.set("$UUID", var_dictionary_1.ValueType.Bytes, (0, byte_utils_1.base64ToBytes)(algo));
                        this.kdfParameters.set("S", var_dictionary_1.ValueType.Bytes, CryptoEngine.random(HeaderConst.DefaultKdfSaltLength));
                        this.kdfParameters.set("P", var_dictionary_1.ValueType.UInt32, HeaderConst.DefaultKdfParallelism);
                        this.kdfParameters.set("I", var_dictionary_1.ValueType.UInt64, new int64_1.Int64(HeaderConst.DefaultKdfIterations));
                        this.kdfParameters.set("M", var_dictionary_1.ValueType.UInt64, new int64_1.Int64(HeaderConst.DefaultKdfMemory));
                        this.kdfParameters.set("V", var_dictionary_1.ValueType.UInt32, HeaderConst.DefaultKdfVersion);
                        break;
                      case consts_1.KdfId.Aes:
                        this.kdfParameters = new var_dictionary_1.VarDictionary();
                        this.kdfParameters.set("$UUID", var_dictionary_1.ValueType.Bytes, (0, byte_utils_1.base64ToBytes)(consts_1.KdfId.Aes));
                        this.kdfParameters.set("S", var_dictionary_1.ValueType.Bytes, CryptoEngine.random(HeaderConst.DefaultKdfSaltLength));
                        this.kdfParameters.set("R", var_dictionary_1.ValueType.UInt64, new int64_1.Int64(consts_1.Defaults.KeyEncryptionRounds));
                        break;
                      default:
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "bad KDF algo");
                    }
                  }
                  write(stm) {
                    this.validate();
                    this.writeSignature(stm);
                    this.writeVersion(stm);
                    for (let id = 1; id < HeaderFields.length; id++) {
                      this.writeField(stm, id, HeaderFields);
                    }
                    this.writeField(stm, 0, HeaderFields);
                    this.endPos = stm.pos;
                  }
                  writeInnerHeader(stm, ctx) {
                    this.validateInner();
                    for (let id = 1; id < InnerHeaderFields.length; id++) {
                      this.writeField(stm, id, InnerHeaderFields, ctx);
                    }
                    this.writeField(stm, 0, InnerHeaderFields, ctx);
                  }
                  generateSalts() {
                    this.masterSeed = CryptoEngine.random(32);
                    if (this.versionMajor < 4) {
                      this.transformSeed = CryptoEngine.random(32);
                      this.streamStartBytes = CryptoEngine.random(32);
                      this.protectedStreamKey = CryptoEngine.random(32);
                      this.encryptionIV = CryptoEngine.random(16);
                    } else {
                      this.protectedStreamKey = CryptoEngine.random(64);
                      if (!this.kdfParameters || !this.dataCipherUuid) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "no kdf params");
                      }
                      this.kdfParameters.set("S", var_dictionary_1.ValueType.Bytes, CryptoEngine.random(32));
                      const ivLength = this.dataCipherUuid.toString() === consts_1.CipherId.ChaCha20 ? 12 : 16;
                      this.encryptionIV = CryptoEngine.random(ivLength);
                    }
                  }
                  setVersion(version) {
                    if (version !== 3 && version !== 4) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "bad file version");
                    }
                    this.versionMajor = version;
                    this.versionMinor = DefaultMinorVersions[version];
                    if (this.versionMajor === 4) {
                      if (!this.kdfParameters) {
                        this.createKdfParameters();
                      }
                      this.crsAlgorithm = consts_1.CrsAlgorithm.ChaCha20;
                      this.keyEncryptionRounds = void 0;
                    } else {
                      this.kdfParameters = void 0;
                      this.crsAlgorithm = consts_1.CrsAlgorithm.Salsa20;
                      this.keyEncryptionRounds = consts_1.Defaults.KeyEncryptionRounds;
                    }
                  }
                  setKdf(kdf) {
                    this.createKdfParameters(kdf);
                  }
                  static read(stm, ctx) {
                    const header = new KdbxHeader();
                    header.readSignature(stm);
                    header.readVersion(stm);
                    while (header.readField(stm, HeaderFields, ctx)) {
                    }
                    header.endPos = stm.pos;
                    header.validate();
                    return header;
                  }
                  readInnerHeader(stm, ctx) {
                    while (this.readField(stm, InnerHeaderFields, ctx)) {
                    }
                    this.validateInner();
                  }
                  static create() {
                    const header = new KdbxHeader();
                    header.versionMajor = HeaderConst.DefaultFileVersionMajor;
                    header.versionMinor = DefaultMinorVersions[HeaderConst.DefaultFileVersionMajor];
                    header.dataCipherUuid = new kdbx_uuid_1.KdbxUuid(consts_1.CipherId.Aes);
                    header.compression = consts_1.CompressionAlgorithm.GZip;
                    header.crsAlgorithm = consts_1.CrsAlgorithm.ChaCha20;
                    header.createKdfParameters();
                    return header;
                  }
                }
                exports2.KdbxHeader = KdbxHeader;
                KdbxHeader.MaxFileVersion = HeaderConst.MaxSupportedVersion;
              })
            ),
            /***/
            "./format/kdbx-meta.ts": (
              /*!*****************************!*\
                !*** ./format/kdbx-meta.ts ***!
                \*****************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxMeta = void 0;
                const kdbx_uuid_1 = __webpack_require__2(
                  /*! ./kdbx-uuid */
                  "./format/kdbx-uuid.ts"
                );
                const XmlUtils = __webpack_require__2(
                  /*! ../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const XmlNames = __webpack_require__2(
                  /*! ../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                const kdbx_custom_data_1 = __webpack_require__2(
                  /*! ./kdbx-custom-data */
                  "./format/kdbx-custom-data.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const kdbx_binaries_1 = __webpack_require__2(
                  /*! ./kdbx-binaries */
                  "./format/kdbx-binaries.ts"
                );
                const MetaConst = {
                  Generator: "KdbxWeb"
                };
                class KdbxMeta {
                  constructor() {
                    this._memoryProtection = {};
                    this.customData = /* @__PURE__ */ new Map();
                    this.customIcons = /* @__PURE__ */ new Map();
                  }
                  get editState() {
                    return this._editState;
                  }
                  set editState(value) {
                    this._editState = value;
                  }
                  getOrCreateEditState() {
                    if (!this._editState) {
                      this._editState = {};
                    }
                    return this._editState;
                  }
                  get name() {
                    return this._name;
                  }
                  set name(value) {
                    if (value !== this._name) {
                      this._name = value;
                      this.nameChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get desc() {
                    return this._desc;
                  }
                  set desc(value) {
                    if (value !== this._desc) {
                      this._desc = value;
                      this.descChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get defaultUser() {
                    return this._defaultUser;
                  }
                  set defaultUser(value) {
                    if (value !== this._defaultUser) {
                      this._defaultUser = value;
                      this.defaultUserChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get mntncHistoryDays() {
                    return this._mntncHistoryDays;
                  }
                  set mntncHistoryDays(value) {
                    if (value !== this._mntncHistoryDays) {
                      this._mntncHistoryDays = value;
                      this.getOrCreateEditState().mntncHistoryDaysChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get color() {
                    return this._color;
                  }
                  set color(value) {
                    if (value !== this._color) {
                      this._color = value;
                      this.getOrCreateEditState().colorChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get keyChangeRec() {
                    return this._keyChangeRec;
                  }
                  set keyChangeRec(value) {
                    if (value !== this._keyChangeRec) {
                      this._keyChangeRec = value;
                      this.getOrCreateEditState().keyChangeRecChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get keyChangeForce() {
                    return this._keyChangeForce;
                  }
                  set keyChangeForce(value) {
                    if (value !== this._keyChangeForce) {
                      this._keyChangeForce = value;
                      this.getOrCreateEditState().keyChangeForceChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get recycleBinEnabled() {
                    return this._recycleBinEnabled;
                  }
                  set recycleBinEnabled(value) {
                    if (value !== this._recycleBinEnabled) {
                      this._recycleBinEnabled = value;
                      this.recycleBinChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get recycleBinUuid() {
                    return this._recycleBinUuid;
                  }
                  set recycleBinUuid(value) {
                    if (value !== this._recycleBinUuid) {
                      this._recycleBinUuid = value;
                      this.recycleBinChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get entryTemplatesGroup() {
                    return this._entryTemplatesGroup;
                  }
                  set entryTemplatesGroup(value) {
                    if (value !== this._entryTemplatesGroup) {
                      this._entryTemplatesGroup = value;
                      this.entryTemplatesGroupChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get historyMaxItems() {
                    return this._historyMaxItems;
                  }
                  set historyMaxItems(value) {
                    if (value !== this._historyMaxItems) {
                      this._historyMaxItems = value;
                      this.getOrCreateEditState().historyMaxItemsChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get historyMaxSize() {
                    return this._historyMaxSize;
                  }
                  set historyMaxSize(value) {
                    if (value !== this._historyMaxSize) {
                      this._historyMaxSize = value;
                      this.getOrCreateEditState().historyMaxSizeChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get lastSelectedGroup() {
                    return this._lastSelectedGroup;
                  }
                  set lastSelectedGroup(value) {
                    if (value !== this._lastSelectedGroup) {
                      this._lastSelectedGroup = value;
                      this.getOrCreateEditState().lastSelectedGroupChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get lastTopVisibleGroup() {
                    return this._lastTopVisibleGroup;
                  }
                  set lastTopVisibleGroup(value) {
                    if (value !== this._lastTopVisibleGroup) {
                      this._lastTopVisibleGroup = value;
                      this.getOrCreateEditState().lastTopVisibleGroupChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  get memoryProtection() {
                    return this._memoryProtection;
                  }
                  set memoryProtection(value) {
                    if (value !== this._memoryProtection) {
                      this._memoryProtection = value;
                      this.getOrCreateEditState().memoryProtectionChanged = /* @__PURE__ */ new Date();
                    }
                  }
                  readNode(node, ctx) {
                    var _a;
                    switch (node.tagName) {
                      case XmlNames.Elem.Generator:
                        this.generator = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.HeaderHash:
                        this.headerHash = XmlUtils.getBytes(node);
                        break;
                      case XmlNames.Elem.SettingsChanged:
                        this.settingsChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.DbName:
                        this._name = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.DbNameChanged:
                        this.nameChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.DbDesc:
                        this._desc = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.DbDescChanged:
                        this.descChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.DbDefaultUser:
                        this._defaultUser = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.DbDefaultUserChanged:
                        this.defaultUserChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.DbMntncHistoryDays:
                        this._mntncHistoryDays = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.DbColor:
                        this._color = XmlUtils.getText(node);
                        break;
                      case XmlNames.Elem.DbKeyChanged:
                        this.keyChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.DbKeyChangeRec:
                        this._keyChangeRec = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.DbKeyChangeForce:
                        this._keyChangeForce = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.RecycleBinEnabled:
                        this._recycleBinEnabled = (_a = XmlUtils.getBoolean(node)) !== null && _a !== void 0 ? _a : void 0;
                        break;
                      case XmlNames.Elem.RecycleBinUuid:
                        this._recycleBinUuid = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.RecycleBinChanged:
                        this.recycleBinChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.EntryTemplatesGroup:
                        this._entryTemplatesGroup = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.EntryTemplatesGroupChanged:
                        this.entryTemplatesGroupChanged = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.HistoryMaxItems:
                        this._historyMaxItems = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.HistoryMaxSize:
                        this._historyMaxSize = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.LastSelectedGroup:
                        this._lastSelectedGroup = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.LastTopVisibleGroup:
                        this._lastTopVisibleGroup = XmlUtils.getUuid(node);
                        break;
                      case XmlNames.Elem.MemoryProt:
                        this.readMemoryProtection(node);
                        break;
                      case XmlNames.Elem.CustomIcons:
                        this.readCustomIcons(node);
                        break;
                      case XmlNames.Elem.Binaries:
                        this.readBinaries(node, ctx);
                        break;
                      case XmlNames.Elem.CustomData:
                        this.readCustomData(node);
                        break;
                    }
                  }
                  readMemoryProtection(node) {
                    var _a, _b, _c, _d, _e;
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.ProtTitle:
                          this.memoryProtection.title = (_a = XmlUtils.getBoolean(childNode)) !== null && _a !== void 0 ? _a : void 0;
                          break;
                        case XmlNames.Elem.ProtUserName:
                          this.memoryProtection.userName = (_b = XmlUtils.getBoolean(childNode)) !== null && _b !== void 0 ? _b : void 0;
                          break;
                        case XmlNames.Elem.ProtPassword:
                          this.memoryProtection.password = (_c = XmlUtils.getBoolean(childNode)) !== null && _c !== void 0 ? _c : void 0;
                          break;
                        case XmlNames.Elem.ProtUrl:
                          this.memoryProtection.url = (_d = XmlUtils.getBoolean(childNode)) !== null && _d !== void 0 ? _d : void 0;
                          break;
                        case XmlNames.Elem.ProtNotes:
                          this.memoryProtection.notes = (_e = XmlUtils.getBoolean(childNode)) !== null && _e !== void 0 ? _e : void 0;
                          break;
                      }
                    }
                  }
                  writeMemoryProtection(parentNode) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.MemoryProt);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.ProtTitle), this.memoryProtection.title);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.ProtUserName), this.memoryProtection.userName);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.ProtPassword), this.memoryProtection.password);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.ProtUrl), this.memoryProtection.url);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.ProtNotes), this.memoryProtection.notes);
                  }
                  readCustomIcons(node) {
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName === XmlNames.Elem.CustomIconItem) {
                        this.readCustomIcon(childNode);
                      }
                    }
                  }
                  readCustomIcon(node) {
                    var _a;
                    let uuid, data, name, lastModified;
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.CustomIconItemID:
                          uuid = XmlUtils.getUuid(childNode);
                          break;
                        case XmlNames.Elem.CustomIconItemData:
                          data = XmlUtils.getBytes(childNode);
                          break;
                        case XmlNames.Elem.CustomIconItemName:
                          name = (_a = XmlUtils.getText(childNode)) !== null && _a !== void 0 ? _a : void 0;
                          break;
                        case XmlNames.Elem.LastModTime:
                          lastModified = XmlUtils.getDate(childNode);
                          break;
                      }
                    }
                    if (uuid && data) {
                      this.customIcons.set(uuid.id, { data, name, lastModified });
                    }
                  }
                  writeCustomIcons(parentNode, ctx) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.CustomIcons);
                    for (const [uuid, { data, name, lastModified }] of this.customIcons) {
                      if (data) {
                        const itemNode = XmlUtils.addChildNode(node, XmlNames.Elem.CustomIconItem);
                        XmlUtils.setUuid(XmlUtils.addChildNode(itemNode, XmlNames.Elem.CustomIconItemID), uuid);
                        XmlUtils.setBytes(XmlUtils.addChildNode(itemNode, XmlNames.Elem.CustomIconItemData), data);
                        if (ctx.kdbx.versionIsAtLeast(4, 1)) {
                          if (name) {
                            XmlUtils.setText(XmlUtils.addChildNode(itemNode, XmlNames.Elem.CustomIconItemName), name);
                          }
                          if (lastModified) {
                            XmlUtils.setDate(XmlUtils.addChildNode(itemNode, XmlNames.Elem.LastModTime), lastModified);
                          }
                        }
                      }
                    }
                  }
                  readBinaries(node, ctx) {
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName === XmlNames.Elem.Binary) {
                        this.readBinary(childNode, ctx);
                      }
                    }
                  }
                  readBinary(node, ctx) {
                    const id = node.getAttribute(XmlNames.Attr.Id);
                    const binary = XmlUtils.getProtectedBinary(node);
                    if (id && binary) {
                      if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryRef(binary)) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "binary ref in meta");
                      }
                      ctx.kdbx.binaries.addWithId(id, binary);
                    }
                  }
                  writeBinaries(parentNode, ctx) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.Binaries);
                    const binaries = ctx.kdbx.binaries.getAll();
                    for (const binary of binaries) {
                      const itemNode = XmlUtils.addChildNode(node, XmlNames.Elem.Binary);
                      itemNode.setAttribute(XmlNames.Attr.Id, binary.ref);
                      XmlUtils.setProtectedBinary(itemNode, binary.value);
                    }
                  }
                  readCustomData(node) {
                    this.customData = kdbx_custom_data_1.KdbxCustomData.read(node);
                  }
                  writeCustomData(parentNode, ctx) {
                    kdbx_custom_data_1.KdbxCustomData.write(parentNode, ctx, this.customData);
                  }
                  write(parentNode, ctx) {
                    this.generator = MetaConst.Generator;
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.Meta);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.Generator), MetaConst.Generator);
                    if (ctx.kdbx.versionMajor < 4) {
                      XmlUtils.setBytes(XmlUtils.addChildNode(node, XmlNames.Elem.HeaderHash), this.headerHash);
                    } else if (this.settingsChanged) {
                      ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.SettingsChanged), this.settingsChanged);
                    }
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.DbName), this.name);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.DbNameChanged), this.nameChanged);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.DbDesc), this.desc);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.DbDescChanged), this.descChanged);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.DbDefaultUser), this.defaultUser);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.DbDefaultUserChanged), this.defaultUserChanged);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.DbMntncHistoryDays), this.mntncHistoryDays);
                    XmlUtils.setText(XmlUtils.addChildNode(node, XmlNames.Elem.DbColor), this.color);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.DbKeyChanged), this.keyChanged);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.DbKeyChangeRec), this.keyChangeRec);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.DbKeyChangeForce), this.keyChangeForce);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.RecycleBinEnabled), this.recycleBinEnabled);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.RecycleBinUuid), this.recycleBinUuid);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.RecycleBinChanged), this.recycleBinChanged);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.EntryTemplatesGroup), this.entryTemplatesGroup);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.EntryTemplatesGroupChanged), this.entryTemplatesGroupChanged);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.HistoryMaxItems), this.historyMaxItems);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.HistoryMaxSize), this.historyMaxSize);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.LastSelectedGroup), this.lastSelectedGroup);
                    XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.LastTopVisibleGroup), this.lastTopVisibleGroup);
                    this.writeMemoryProtection(node);
                    this.writeCustomIcons(node, ctx);
                    if (ctx.exportXml || ctx.kdbx.versionMajor < 4) {
                      this.writeBinaries(node, ctx);
                    }
                    this.writeCustomData(node, ctx);
                  }
                  merge(remote, objectMap) {
                    var _a, _b, _c, _d, _e, _f;
                    if (this.needUpdate(remote.nameChanged, this.nameChanged)) {
                      this._name = remote.name;
                      this.nameChanged = remote.nameChanged;
                    }
                    if (this.needUpdate(remote.descChanged, this.descChanged)) {
                      this._desc = remote.desc;
                      this.descChanged = remote.descChanged;
                    }
                    if (this.needUpdate(remote.defaultUserChanged, this.defaultUserChanged)) {
                      this._defaultUser = remote.defaultUser;
                      this.defaultUserChanged = remote.defaultUserChanged;
                    }
                    if (this.needUpdate(remote.keyChanged, this.keyChanged)) {
                      this.keyChanged = remote.keyChanged;
                    }
                    if (this.needUpdate(remote.settingsChanged, this.settingsChanged)) {
                      this.settingsChanged = remote.settingsChanged;
                    }
                    if (this.needUpdate(remote.recycleBinChanged, this.recycleBinChanged)) {
                      this._recycleBinEnabled = remote.recycleBinEnabled;
                      this._recycleBinUuid = remote.recycleBinUuid;
                      this.recycleBinChanged = remote.recycleBinChanged;
                    }
                    if (this.needUpdate(remote.entryTemplatesGroupChanged, this.entryTemplatesGroupChanged)) {
                      this._entryTemplatesGroup = remote.entryTemplatesGroup;
                      this.entryTemplatesGroupChanged = remote.entryTemplatesGroupChanged;
                    }
                    this.mergeMapWithDates(this.customData, remote.customData, objectMap);
                    this.mergeMapWithDates(this.customIcons, remote.customIcons, objectMap);
                    if (!((_a = this._editState) === null || _a === void 0 ? void 0 : _a.historyMaxItemsChanged)) {
                      this.historyMaxItems = remote.historyMaxItems;
                    }
                    if (!((_b = this._editState) === null || _b === void 0 ? void 0 : _b.historyMaxSizeChanged)) {
                      this.historyMaxSize = remote.historyMaxSize;
                    }
                    if (!((_c = this._editState) === null || _c === void 0 ? void 0 : _c.keyChangeRecChanged)) {
                      this.keyChangeRec = remote.keyChangeRec;
                    }
                    if (!((_d = this._editState) === null || _d === void 0 ? void 0 : _d.keyChangeForceChanged)) {
                      this.keyChangeForce = remote.keyChangeForce;
                    }
                    if (!((_e = this._editState) === null || _e === void 0 ? void 0 : _e.mntncHistoryDaysChanged)) {
                      this.mntncHistoryDays = remote.mntncHistoryDays;
                    }
                    if (!((_f = this._editState) === null || _f === void 0 ? void 0 : _f.colorChanged)) {
                      this.color = remote.color;
                    }
                  }
                  mergeMapWithDates(local, remote, objectMap) {
                    for (const [key, remoteItem] of remote) {
                      const existingItem = local.get(key);
                      if (existingItem) {
                        if (existingItem.lastModified && remoteItem.lastModified && remoteItem.lastModified > existingItem.lastModified) {
                          local.set(key, remoteItem);
                        }
                      } else if (!objectMap.deleted.has(key)) {
                        local.set(key, remoteItem);
                      }
                    }
                  }
                  needUpdate(remoteDate, localDate) {
                    if (!remoteDate) {
                      return false;
                    }
                    if (!localDate) {
                      return true;
                    }
                    return remoteDate > localDate;
                  }
                  /**
                   * Creates new meta
                   * @returns {KdbxMeta}
                   */
                  static create() {
                    const now = /* @__PURE__ */ new Date();
                    const meta = new KdbxMeta();
                    meta.generator = MetaConst.Generator;
                    meta.settingsChanged = now;
                    meta.mntncHistoryDays = consts_1.Defaults.MntncHistoryDays;
                    meta.recycleBinEnabled = true;
                    meta.historyMaxItems = consts_1.Defaults.HistoryMaxItems;
                    meta.historyMaxSize = consts_1.Defaults.HistoryMaxSize;
                    meta.nameChanged = now;
                    meta.descChanged = now;
                    meta.defaultUserChanged = now;
                    meta.recycleBinChanged = now;
                    meta.keyChangeRec = -1;
                    meta.keyChangeForce = -1;
                    meta.entryTemplatesGroup = new kdbx_uuid_1.KdbxUuid();
                    meta.entryTemplatesGroupChanged = now;
                    meta.memoryProtection = {
                      title: false,
                      userName: false,
                      password: true,
                      url: false,
                      notes: false
                    };
                    return meta;
                  }
                  static read(xmlNode, ctx) {
                    const meta = new KdbxMeta();
                    for (let i = 0, cn = xmlNode.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName) {
                        meta.readNode(childNode, ctx);
                      }
                    }
                    return meta;
                  }
                }
                exports2.KdbxMeta = KdbxMeta;
              })
            ),
            /***/
            "./format/kdbx-times.ts": (
              /*!******************************!*\
                !*** ./format/kdbx-times.ts ***!
                \******************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxTimes = void 0;
                const XmlNames = __webpack_require__2(
                  /*! ./../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                const XmlUtils = __webpack_require__2(
                  /*! ./../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                class KdbxTimes {
                  readNode(node) {
                    switch (node.tagName) {
                      case XmlNames.Elem.CreationTime:
                        this.creationTime = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.LastModTime:
                        this.lastModTime = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.LastAccessTime:
                        this.lastAccessTime = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.ExpiryTime:
                        this.expiryTime = XmlUtils.getDate(node);
                        break;
                      case XmlNames.Elem.Expires:
                        this.expires = XmlUtils.getBoolean(node);
                        break;
                      case XmlNames.Elem.UsageCount:
                        this.usageCount = XmlUtils.getNumber(node);
                        break;
                      case XmlNames.Elem.LocationChanged:
                        this.locationChanged = XmlUtils.getDate(node);
                        break;
                    }
                  }
                  clone() {
                    const clone = new KdbxTimes();
                    clone.creationTime = this.creationTime;
                    clone.lastModTime = this.lastModTime;
                    clone.lastAccessTime = this.lastAccessTime;
                    clone.expiryTime = this.expiryTime;
                    clone.expires = this.expires;
                    clone.usageCount = this.usageCount;
                    clone.locationChanged = this.locationChanged;
                    return clone;
                  }
                  update() {
                    const now = /* @__PURE__ */ new Date();
                    this.lastModTime = now;
                    this.lastAccessTime = now;
                  }
                  write(parentNode, ctx) {
                    const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.Times);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.CreationTime), this.creationTime);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.LastModTime), this.lastModTime);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.LastAccessTime), this.lastAccessTime);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.ExpiryTime), this.expiryTime);
                    XmlUtils.setBoolean(XmlUtils.addChildNode(node, XmlNames.Elem.Expires), this.expires);
                    XmlUtils.setNumber(XmlUtils.addChildNode(node, XmlNames.Elem.UsageCount), this.usageCount);
                    ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.LocationChanged), this.locationChanged);
                  }
                  static create() {
                    const times = new KdbxTimes();
                    const now = /* @__PURE__ */ new Date();
                    times.creationTime = now;
                    times.lastModTime = now;
                    times.lastAccessTime = now;
                    times.expiryTime = now;
                    times.expires = false;
                    times.usageCount = 0;
                    times.locationChanged = now;
                    return times;
                  }
                  static read(xmlNode) {
                    const obj = new KdbxTimes();
                    for (let i = 0, cn = xmlNode.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      if (childNode.tagName) {
                        obj.readNode(childNode);
                      }
                    }
                    return obj;
                  }
                }
                exports2.KdbxTimes = KdbxTimes;
              })
            ),
            /***/
            "./format/kdbx-uuid.ts": (
              /*!*****************************!*\
                !*** ./format/kdbx-uuid.ts ***!
                \*****************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.KdbxUuid = void 0;
                const byte_utils_1 = __webpack_require__2(
                  /*! ../utils/byte-utils */
                  "./utils/byte-utils.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const CryptoEngine = __webpack_require__2(
                  /*! ../crypto/crypto-engine */
                  "./crypto/crypto-engine.ts"
                );
                const UuidLength = 16;
                const EmptyUuidStr = "AAAAAAAAAAAAAAAAAAAAAA==";
                class KdbxUuid {
                  constructor(ab) {
                    if (ab === void 0) {
                      ab = new ArrayBuffer(UuidLength);
                    } else if (typeof ab === "string") {
                      ab = (0, byte_utils_1.base64ToBytes)(ab);
                    }
                    if (ab.byteLength !== UuidLength) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, `bad UUID length: ${ab.byteLength}`);
                    }
                    this.id = (0, byte_utils_1.bytesToBase64)(ab);
                    this.empty = this.id === EmptyUuidStr;
                  }
                  equals(other) {
                    return other && other.toString() === this.toString() || false;
                  }
                  get bytes() {
                    return this.toBytes();
                  }
                  static random() {
                    return new KdbxUuid(CryptoEngine.random(UuidLength));
                  }
                  toString() {
                    return this.id;
                  }
                  valueOf() {
                    return this.id;
                  }
                  toBytes() {
                    return (0, byte_utils_1.base64ToBytes)(this.id);
                  }
                }
                exports2.KdbxUuid = KdbxUuid;
              })
            ),
            /***/
            "./format/kdbx.ts": (
              /*!************************!*\
                !*** ./format/kdbx.ts ***!
                \************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.Kdbx = void 0;
                const XmlNames = __webpack_require__2(
                  /*! ../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                const XmlUtils = __webpack_require__2(
                  /*! ./../utils/xml-utils */
                  "./utils/xml-utils.ts"
                );
                const kdbx_binaries_1 = __webpack_require__2(
                  /*! ./kdbx-binaries */
                  "./format/kdbx-binaries.ts"
                );
                const kdbx_deleted_object_1 = __webpack_require__2(
                  /*! ./kdbx-deleted-object */
                  "./format/kdbx-deleted-object.ts"
                );
                const kdbx_group_1 = __webpack_require__2(
                  /*! ./kdbx-group */
                  "./format/kdbx-group.ts"
                );
                const kdbx_meta_1 = __webpack_require__2(
                  /*! ./kdbx-meta */
                  "./format/kdbx-meta.ts"
                );
                const kdbx_credentials_1 = __webpack_require__2(
                  /*! ./kdbx-credentials */
                  "./format/kdbx-credentials.ts"
                );
                const kdbx_header_1 = __webpack_require__2(
                  /*! ./kdbx-header */
                  "./format/kdbx-header.ts"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const kdbx_format_1 = __webpack_require__2(
                  /*! ./kdbx-format */
                  "./format/kdbx-format.ts"
                );
                const kdbx_entry_1 = __webpack_require__2(
                  /*! ./kdbx-entry */
                  "./format/kdbx-entry.ts"
                );
                const kdbx_uuid_1 = __webpack_require__2(
                  /*! ./kdbx-uuid */
                  "./format/kdbx-uuid.ts"
                );
                class Kdbx {
                  constructor() {
                    this.header = new kdbx_header_1.KdbxHeader();
                    this.credentials = new kdbx_credentials_1.KdbxCredentials(null);
                    this.meta = new kdbx_meta_1.KdbxMeta();
                    this.binaries = new kdbx_binaries_1.KdbxBinaries();
                    this.groups = [];
                    this.deletedObjects = [];
                  }
                  get versionMajor() {
                    return this.header.versionMajor;
                  }
                  get versionMinor() {
                    return this.header.versionMinor;
                  }
                  /**
                   * Creates a new database
                   */
                  static create(credentials, name) {
                    if (!(credentials instanceof kdbx_credentials_1.KdbxCredentials)) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "credentials");
                    }
                    const kdbx = new Kdbx();
                    kdbx.credentials = credentials;
                    kdbx.header = kdbx_header_1.KdbxHeader.create();
                    kdbx.meta = kdbx_meta_1.KdbxMeta.create();
                    kdbx.meta._name = name;
                    kdbx.createDefaultGroup();
                    kdbx.createRecycleBin();
                    kdbx.meta._lastSelectedGroup = kdbx.getDefaultGroup().uuid;
                    kdbx.meta._lastTopVisibleGroup = kdbx.getDefaultGroup().uuid;
                    return kdbx;
                  }
                  /**
                   * Load a kdbx file
                   * If there was an error loading file, throws an exception
                   */
                  static load(data, credentials, options) {
                    if (!(data instanceof ArrayBuffer)) {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "data"));
                    }
                    if (!(credentials instanceof kdbx_credentials_1.KdbxCredentials)) {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "credentials"));
                    }
                    const kdbx = new Kdbx();
                    kdbx.credentials = credentials;
                    const format = new kdbx_format_1.KdbxFormat(kdbx);
                    format.preserveXml = (options === null || options === void 0 ? void 0 : options.preserveXml) || false;
                    return format.load(data);
                  }
                  /**
                   * Import database from an xml file
                   * If there was an error loading file, throws an exception
                   */
                  static loadXml(data, credentials) {
                    if (typeof data !== "string") {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "data"));
                    }
                    if (!(credentials instanceof kdbx_credentials_1.KdbxCredentials)) {
                      return Promise.reject(new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg, "credentials"));
                    }
                    const kdbx = new Kdbx();
                    kdbx.credentials = credentials;
                    const format = new kdbx_format_1.KdbxFormat(kdbx);
                    return format.loadXml(data);
                  }
                  /**
                   * Save the db to ArrayBuffer
                   */
                  save() {
                    const format = new kdbx_format_1.KdbxFormat(this);
                    return format.save();
                  }
                  /**
                   * Save the db as XML string
                   */
                  saveXml(prettyPrint = false) {
                    const format = new kdbx_format_1.KdbxFormat(this);
                    return format.saveXml(prettyPrint);
                  }
                  /**
                   * Creates a default group, if it's not yet created
                   */
                  createDefaultGroup() {
                    if (this.groups.length) {
                      return;
                    }
                    const defaultGroup = kdbx_group_1.KdbxGroup.create(this.meta.name || "");
                    defaultGroup.icon = consts_1.Icons.FolderOpen;
                    defaultGroup.expanded = true;
                    this.groups.push(defaultGroup);
                  }
                  /**
                   * Creates a recycle bin group, if it's not yet created
                   */
                  createRecycleBin() {
                    this.meta.recycleBinEnabled = true;
                    if (this.meta.recycleBinUuid && this.getGroup(this.meta.recycleBinUuid)) {
                      return;
                    }
                    const defGrp = this.getDefaultGroup();
                    const recycleBin2 = kdbx_group_1.KdbxGroup.create(consts_1.Defaults.RecycleBinName, defGrp);
                    recycleBin2.icon = consts_1.Icons.TrashBin;
                    recycleBin2.enableAutoType = false;
                    recycleBin2.enableSearching = false;
                    this.meta.recycleBinUuid = recycleBin2.uuid;
                    defGrp.groups.push(recycleBin2);
                  }
                  /**
                   * Adds a new group to an existing group
                   */
                  createGroup(group, name) {
                    const subGroup = kdbx_group_1.KdbxGroup.create(name, group);
                    group.groups.push(subGroup);
                    return subGroup;
                  }
                  /**
                   * Adds a new entry to a group
                   */
                  createEntry(group) {
                    const entry = kdbx_entry_1.KdbxEntry.create(this.meta, group);
                    group.entries.push(entry);
                    return entry;
                  }
                  /**
                   * Gets the default group
                   */
                  getDefaultGroup() {
                    if (!this.groups[0]) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "empty default group");
                    }
                    return this.groups[0];
                  }
                  /**
                   * Get a group by uuid, returns undefined if it's not found
                   */
                  getGroup(uuid, parentGroup) {
                    const groups = parentGroup ? parentGroup.groups : this.groups;
                    for (const group of groups) {
                      if (group.uuid.equals(uuid)) {
                        return group;
                      }
                      const res = this.getGroup(uuid, group);
                      if (res) {
                        return res;
                      }
                    }
                  }
                  /**
                   * Move an object from one group to another
                   * @param object - object to be moved
                   * @param toGroup - target parent group
                   * @param atIndex - index in target group (by default, insert to the end of the group)
                   */
                  move(object, toGroup, atIndex) {
                    var _a, _b;
                    const containerProp = object instanceof kdbx_group_1.KdbxGroup ? "groups" : "entries";
                    const fromContainer = (_a = object.parentGroup) === null || _a === void 0 ? void 0 : _a[containerProp];
                    const ix = fromContainer === null || fromContainer === void 0 ? void 0 : fromContainer.indexOf(object);
                    if (typeof ix !== "number" || ix < 0) {
                      return;
                    }
                    fromContainer.splice(ix, 1);
                    if (toGroup) {
                      const toContainer = toGroup[containerProp];
                      if (typeof atIndex === "number" && atIndex >= 0) {
                        toContainer.splice(atIndex, 0, object);
                      } else {
                        toContainer.push(object);
                      }
                    } else {
                      const now = /* @__PURE__ */ new Date();
                      if (object instanceof kdbx_group_1.KdbxGroup) {
                        for (const item of object.allGroupsAndEntries()) {
                          const uuid = item.uuid;
                          this.addDeletedObject(uuid, now);
                        }
                      } else {
                        if (object.uuid) {
                          this.addDeletedObject(object.uuid, now);
                        }
                      }
                    }
                    object.previousParentGroup = (_b = object.parentGroup) === null || _b === void 0 ? void 0 : _b.uuid;
                    object.parentGroup = toGroup !== null && toGroup !== void 0 ? toGroup : void 0;
                    object.times.locationChanged = /* @__PURE__ */ new Date();
                  }
                  /**
                   * Adds a so-called deleted object, this is used to keep track of objects during merging
                   * @param uuid - object uuid
                   * @param dt - deletion date
                   */
                  addDeletedObject(uuid, dt) {
                    const deletedObject = new kdbx_deleted_object_1.KdbxDeletedObject();
                    deletedObject.uuid = uuid;
                    deletedObject.deletionTime = dt;
                    this.deletedObjects.push(deletedObject);
                  }
                  /**
                   * Delete an entry or a group
                   * Depending on settings, removes either to trash, or completely
                   */
                  remove(object) {
                    let toGroup = void 0;
                    if (this.meta.recycleBinEnabled && this.meta.recycleBinUuid) {
                      this.createRecycleBin();
                      toGroup = this.getGroup(this.meta.recycleBinUuid);
                    }
                    this.move(object, toGroup);
                  }
                  /**
                   * Creates a binary in the db and returns an object that can be put to entry.binaries
                   */
                  createBinary(value) {
                    return this.binaries.add(value);
                  }
                  /**
                   * Import an entry from another file
                   * It's up to caller to decide what should happen to the original entry in the source file
                   * Returns the new entry
                   * @param entry - entry to be imported
                   * @param group - target parent group
                   * @param file - the source file containing the group
                   */
                  importEntry(entry, group, file) {
                    const newEntry = new kdbx_entry_1.KdbxEntry();
                    const uuid = kdbx_uuid_1.KdbxUuid.random();
                    newEntry.copyFrom(entry);
                    newEntry.uuid = uuid;
                    for (const historyEntry of entry.history) {
                      const newHistoryEntry = new kdbx_entry_1.KdbxEntry();
                      newHistoryEntry.copyFrom(historyEntry);
                      newHistoryEntry.uuid = uuid;
                      newEntry.history.push(newHistoryEntry);
                    }
                    const binaries = /* @__PURE__ */ new Map();
                    const customIcons = /* @__PURE__ */ new Set();
                    for (const e of newEntry.history.concat(newEntry)) {
                      if (e.customIcon) {
                        customIcons.add(e.customIcon.id);
                      }
                      for (const binary of e.binaries.values()) {
                        if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryWithHash(binary)) {
                          binaries.set(binary.hash, binary);
                        }
                      }
                    }
                    for (const binary of binaries.values()) {
                      const fileBinary = file.binaries.getValueByHash(binary.hash);
                      if (fileBinary && !this.binaries.getValueByHash(binary.hash)) {
                        this.binaries.addWithHash(binary);
                      }
                    }
                    for (const customIconId of customIcons) {
                      const customIcon = file.meta.customIcons.get(customIconId);
                      if (customIcon) {
                        this.meta.customIcons.set(customIconId, customIcon);
                      }
                    }
                    group.entries.push(newEntry);
                    newEntry.parentGroup = group;
                    newEntry.times.update();
                    return newEntry;
                  }
                  /**
                   * Perform database cleanup
                   * @param settings.historyRules - remove extra history, it it doesn't match defined rules, e.g. records number
                   * @param settings.customIcons - remove unused custom icons
                   * @param settings.binaries - remove unused binaries
                   */
                  cleanup(settings) {
                    const now = /* @__PURE__ */ new Date();
                    const historyMaxItems = (settings === null || settings === void 0 ? void 0 : settings.historyRules) && typeof this.meta.historyMaxItems === "number" && this.meta.historyMaxItems >= 0 ? this.meta.historyMaxItems : Infinity;
                    const usedCustomIcons = /* @__PURE__ */ new Set();
                    const usedBinaries = /* @__PURE__ */ new Set();
                    const processEntry = (entry) => {
                      if (entry.customIcon) {
                        usedCustomIcons.add(entry.customIcon.id);
                      }
                      for (const binary of entry.binaries.values()) {
                        if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryWithHash(binary)) {
                          usedBinaries.add(binary.hash);
                        }
                      }
                    };
                    for (const item of this.getDefaultGroup().allGroupsAndEntries()) {
                      if (item instanceof kdbx_entry_1.KdbxEntry) {
                        if (item.history.length > historyMaxItems) {
                          item.removeHistory(0, item.history.length - historyMaxItems);
                        }
                        processEntry(item);
                        if (item.history) {
                          for (const historyEntry of item.history) {
                            processEntry(historyEntry);
                          }
                        }
                      } else {
                        if (item.customIcon) {
                          usedCustomIcons.add(item.customIcon.id);
                        }
                      }
                    }
                    if (settings === null || settings === void 0 ? void 0 : settings.customIcons) {
                      for (const customIcon of this.meta.customIcons.keys()) {
                        if (!usedCustomIcons.has(customIcon)) {
                          const uuid = new kdbx_uuid_1.KdbxUuid(customIcon);
                          this.addDeletedObject(uuid, now);
                          this.meta.customIcons.delete(customIcon);
                        }
                      }
                    }
                    if (settings === null || settings === void 0 ? void 0 : settings.binaries) {
                      for (const binary of this.binaries.getAllWithHashes()) {
                        if (!usedBinaries.has(binary.hash)) {
                          this.binaries.deleteWithHash(binary.hash);
                        }
                      }
                    }
                  }
                  /**
                   * Merge the db with another db
                   * Some parts of the remote DB are copied by reference, so it should NOT be modified after merge
                   * Suggested use case:
                   * - open the local db
                   * - get a remote db somehow and open in
                   * - merge the remote db into the local db: local.merge(remote)
                   * - close the remote db
                   * @param remote - database to merge in
                   */
                  merge(remote) {
                    const root = this.getDefaultGroup();
                    const remoteRoot = remote.getDefaultGroup();
                    if (!root || !remoteRoot) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.MergeError, "no default group");
                    }
                    if (!root.uuid.equals(remoteRoot.uuid)) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.MergeError, "default group is different");
                    }
                    const objectMap = this.getObjectMap();
                    for (const rem of remote.deletedObjects) {
                      if (rem.uuid && rem.deletionTime && !objectMap.deleted.has(rem.uuid.id)) {
                        this.deletedObjects.push(rem);
                        objectMap.deleted.set(rem.uuid.id, rem.deletionTime);
                      }
                    }
                    for (const remoteBinary of remote.binaries.getAllWithHashes()) {
                      if (!this.binaries.getValueByHash(remoteBinary.hash)) {
                        this.binaries.addWithHash(remoteBinary);
                      }
                    }
                    const remoteObjectMap = remote.getObjectMap();
                    objectMap.remoteEntries = remoteObjectMap.entries;
                    objectMap.remoteGroups = remoteObjectMap.groups;
                    this.meta.merge(remote.meta, objectMap);
                    root.merge(objectMap);
                    this.cleanup({ historyRules: true, customIcons: true, binaries: true });
                  }
                  /**
                   * Gets editing state tombstones (for successful merge)
                   * The replica must save this state with the db, assign in on opening the db,
                   * and call removeLocalEditState on successful upstream push.
                   * This state is JSON serializable.
                   */
                  getLocalEditState() {
                    const editingState = {
                      entries: {}
                    };
                    for (const entry of this.getDefaultGroup().allEntries()) {
                      if (entry._editState && entry.uuid && editingState.entries) {
                        editingState.entries[entry.uuid.id] = entry._editState;
                      }
                    }
                    if (this.meta._editState) {
                      editingState.meta = this.meta._editState;
                    }
                    return editingState;
                  }
                  /**
                   * Sets editing state tombstones returned previously by getLocalEditState
                   * The replica must call this method on opening the db to the state returned previously on getLocalEditState.
                   * @param editingState - result of getLocalEditState invoked before on saving the db
                   */
                  setLocalEditState(editingState) {
                    var _a;
                    for (const entry of this.getDefaultGroup().allEntries()) {
                      if ((_a = editingState.entries) === null || _a === void 0 ? void 0 : _a[entry.uuid.id]) {
                        entry._editState = editingState.entries[entry.uuid.id];
                      }
                    }
                    if (editingState.meta) {
                      this.meta._editState = editingState.meta;
                    }
                  }
                  /**
                   * Removes editing state tombstones
                   * Immediately after successful upstream push the replica must:
                   * - call this method
                   * - discard any previous state obtained by getLocalEditState call before
                   */
                  removeLocalEditState() {
                    for (const entry of this.getDefaultGroup().allEntries()) {
                      entry._editState = void 0;
                    }
                    this.meta._editState = void 0;
                  }
                  /**
                   * Upgrade the file to latest version
                   */
                  upgrade() {
                    this.setVersion(kdbx_header_1.KdbxHeader.MaxFileVersion);
                  }
                  /**
                   * Set the file version to a specified number
                   */
                  setVersion(version) {
                    this.meta.headerHash = void 0;
                    this.meta.settingsChanged = /* @__PURE__ */ new Date();
                    this.header.setVersion(version);
                  }
                  /**
                   * Set file key derivation function
                   * @param kdf - KDF id, from KdfId
                   */
                  setKdf(kdf) {
                    this.meta.headerHash = void 0;
                    this.meta.settingsChanged = /* @__PURE__ */ new Date();
                    this.header.setKdf(kdf);
                  }
                  getObjectMap() {
                    const objectMap = {
                      entries: /* @__PURE__ */ new Map(),
                      groups: /* @__PURE__ */ new Map(),
                      remoteEntries: /* @__PURE__ */ new Map(),
                      remoteGroups: /* @__PURE__ */ new Map(),
                      deleted: /* @__PURE__ */ new Map()
                    };
                    for (const item of this.getDefaultGroup().allGroupsAndEntries()) {
                      if (objectMap.entries.has(item.uuid.id)) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.MergeError, `duplicate: ${item.uuid}`);
                      }
                      if (item instanceof kdbx_entry_1.KdbxEntry) {
                        objectMap.entries.set(item.uuid.id, item);
                      } else {
                        objectMap.groups.set(item.uuid.id, item);
                      }
                    }
                    for (const deletedObject of this.deletedObjects) {
                      if (deletedObject.uuid && deletedObject.deletionTime) {
                        objectMap.deleted.set(deletedObject.uuid.id, deletedObject.deletionTime);
                      }
                    }
                    return objectMap;
                  }
                  loadFromXml(ctx) {
                    if (!this.xml) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "xml is not set");
                    }
                    const doc = this.xml.documentElement;
                    if (doc.tagName !== XmlNames.Elem.DocNode) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad xml root");
                    }
                    this.parseMeta(ctx);
                    return this.binaries.computeHashes().then(() => {
                      this.parseRoot(ctx);
                      return this;
                    });
                  }
                  parseMeta(ctx) {
                    if (!this.xml) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "xml is not set");
                    }
                    const node = XmlUtils.getChildNode(this.xml.documentElement, XmlNames.Elem.Meta, "no meta node");
                    this.meta = kdbx_meta_1.KdbxMeta.read(node, ctx);
                  }
                  parseRoot(ctx) {
                    if (!this.xml) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidState, "xml is not set");
                    }
                    this.groups = [];
                    this.deletedObjects = [];
                    const node = XmlUtils.getChildNode(this.xml.documentElement, XmlNames.Elem.Root, "no root node");
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.Group:
                          this.readGroup(childNode, ctx);
                          break;
                        case XmlNames.Elem.DeletedObjects:
                          this.readDeletedObjects(childNode);
                          break;
                      }
                    }
                  }
                  readDeletedObjects(node) {
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      const childNode = cn[i];
                      switch (childNode.tagName) {
                        case XmlNames.Elem.DeletedObject:
                          this.deletedObjects.push(kdbx_deleted_object_1.KdbxDeletedObject.read(childNode));
                          break;
                      }
                    }
                  }
                  readGroup(node, ctx) {
                    this.groups.push(kdbx_group_1.KdbxGroup.read(node, ctx));
                  }
                  buildXml(ctx) {
                    const xml = XmlUtils.create(XmlNames.Elem.DocNode);
                    this.meta.write(xml.documentElement, ctx);
                    const rootNode = XmlUtils.addChildNode(xml.documentElement, XmlNames.Elem.Root);
                    for (const g of this.groups) {
                      g.write(rootNode, ctx);
                    }
                    const delObjNode = XmlUtils.addChildNode(rootNode, XmlNames.Elem.DeletedObjects);
                    for (const d of this.deletedObjects) {
                      d.write(delObjNode, ctx);
                    }
                    this.xml = xml;
                  }
                  versionIsAtLeast(major, minor) {
                    return this.versionMajor > major || this.versionMajor === major && this.versionMinor >= minor;
                  }
                }
                exports2.Kdbx = Kdbx;
              })
            ),
            /***/
            "./utils/binary-stream.ts": (
              /*!********************************!*\
                !*** ./utils/binary-stream.ts ***!
                \********************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.BinaryStream = void 0;
                class BinaryStream {
                  constructor(arrayBuffer) {
                    this._arrayBuffer = arrayBuffer || new ArrayBuffer(1024);
                    this._dataView = new DataView(this._arrayBuffer);
                    this._pos = 0;
                    this._canExpand = !arrayBuffer;
                  }
                  get pos() {
                    return this._pos;
                  }
                  get byteLength() {
                    return this._arrayBuffer.byteLength;
                  }
                  readBytes(size) {
                    const buffer = this._arrayBuffer.slice(this._pos, this._pos + size);
                    this._pos += size;
                    return buffer;
                  }
                  readBytesToEnd() {
                    const size = this._arrayBuffer.byteLength - this._pos;
                    return this.readBytes(size);
                  }
                  readBytesNoAdvance(startPos, endPos) {
                    return this._arrayBuffer.slice(startPos, endPos);
                  }
                  writeBytes(bytes) {
                    const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
                    this.checkCapacity(arr.length);
                    new Uint8Array(this._arrayBuffer).set(arr, this._pos);
                    this._pos += arr.length;
                  }
                  getWrittenBytes() {
                    return this._arrayBuffer.slice(0, this._pos);
                  }
                  checkCapacity(addBytes) {
                    const available = this._arrayBuffer.byteLength - this._pos;
                    if (this._canExpand && available < addBytes) {
                      let newLen = this._arrayBuffer.byteLength;
                      const requestedLen = this._pos + addBytes;
                      while (newLen < requestedLen) {
                        newLen *= 2;
                      }
                      const newData = new Uint8Array(newLen);
                      newData.set(new Uint8Array(this._arrayBuffer));
                      this._arrayBuffer = newData.buffer;
                      this._dataView = new DataView(this._arrayBuffer);
                    }
                  }
                  getInt8() {
                    const value = this._dataView.getInt8(this._pos);
                    this._pos += 1;
                    return value;
                  }
                  setInt8(value) {
                    this.checkCapacity(1);
                    this._dataView.setInt8(this._pos, value);
                    this._pos += 1;
                  }
                  getUint8() {
                    const value = this._dataView.getUint8(this._pos);
                    this._pos += 1;
                    return value;
                  }
                  setUint8(value) {
                    this.checkCapacity(1);
                    this._dataView.setUint8(this._pos, value);
                    this._pos += 1;
                  }
                  getInt16(littleEndian) {
                    const value = this._dataView.getInt16(this._pos, littleEndian);
                    this._pos += 2;
                    return value;
                  }
                  setInt16(value, littleEndian) {
                    this.checkCapacity(2);
                    this._dataView.setInt16(this._pos, value, littleEndian);
                    this._pos += 2;
                  }
                  getUint16(littleEndian) {
                    const value = this._dataView.getUint16(this._pos, littleEndian);
                    this._pos += 2;
                    return value;
                  }
                  setUint16(value, littleEndian) {
                    this.checkCapacity(2);
                    this._dataView.setUint16(this._pos, value, littleEndian);
                    this._pos += 2;
                  }
                  getInt32(littleEndian) {
                    const value = this._dataView.getInt32(this._pos, littleEndian);
                    this._pos += 4;
                    return value;
                  }
                  setInt32(value, littleEndian) {
                    this.checkCapacity(4);
                    this._dataView.setInt32(this._pos, value, littleEndian);
                    this._pos += 4;
                  }
                  getUint32(littleEndian) {
                    const value = this._dataView.getUint32(this._pos, littleEndian);
                    this._pos += 4;
                    return value;
                  }
                  setUint32(value, littleEndian) {
                    this.checkCapacity(4);
                    this._dataView.setUint32(this._pos, value, littleEndian);
                    this._pos += 4;
                  }
                  getFloat32(littleEndian) {
                    const value = this._dataView.getFloat32(this._pos, littleEndian);
                    this._pos += 4;
                    return value;
                  }
                  setFloat32(value, littleEndian) {
                    this.checkCapacity(4);
                    this._dataView.setFloat32(this._pos, value, littleEndian);
                    this._pos += 4;
                  }
                  getFloat64(littleEndian) {
                    const value = this._dataView.getFloat64(this._pos, littleEndian);
                    this._pos += 8;
                    return value;
                  }
                  setFloat64(value, littleEndian) {
                    this.checkCapacity(8);
                    this._dataView.setFloat64(this._pos, value, littleEndian);
                    this._pos += 8;
                  }
                  getUint64(littleEndian) {
                    let part1 = this.getUint32(littleEndian), part2 = this.getUint32(littleEndian);
                    if (littleEndian) {
                      part2 *= 4294967296;
                    } else {
                      part1 *= 4294967296;
                    }
                    return part1 + part2;
                  }
                  setUint64(value, littleEndian) {
                    if (littleEndian) {
                      this.setUint32(value & 4294967295, true);
                      this.setUint32(Math.floor(value / 4294967296), true);
                    } else {
                      this.checkCapacity(8);
                      this.setUint32(Math.floor(value / 4294967296), false);
                      this.setUint32(value & 4294967295, false);
                    }
                  }
                }
                exports2.BinaryStream = BinaryStream;
              })
            ),
            /***/
            "./utils/byte-utils.ts": (
              /*!*****************************!*\
                !*** ./utils/byte-utils.ts ***!
                \*****************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.zeroBuffer = exports2.arrayToBuffer = exports2.bytesToHex = exports2.hexToBytes = exports2.bytesToBase64 = exports2.base64ToBytes = exports2.stringToBytes = exports2.bytesToString = exports2.arrayBufferEquals = void 0;
                const textEncoder = new TextEncoder();
                const textDecoder = new TextDecoder();
                function arrayBufferEquals(ab1, ab2) {
                  if (ab1.byteLength !== ab2.byteLength) {
                    return false;
                  }
                  const arr1 = new Uint8Array(ab1);
                  const arr2 = new Uint8Array(ab2);
                  for (let i = 0, len = arr1.length; i < len; i++) {
                    if (arr1[i] !== arr2[i]) {
                      return false;
                    }
                  }
                  return true;
                }
                exports2.arrayBufferEquals = arrayBufferEquals;
                function bytesToString(arr) {
                  if (arr instanceof ArrayBuffer) {
                    arr = new Uint8Array(arr);
                  }
                  return textDecoder.decode(arr);
                }
                exports2.bytesToString = bytesToString;
                function stringToBytes(str) {
                  return textEncoder.encode(str);
                }
                exports2.stringToBytes = stringToBytes;
                function base64ToBytes2(str) {
                  if (typeof atob === "function") {
                    const byteStr = atob(str);
                    const arr = new Uint8Array(byteStr.length);
                    for (let i = 0; i < byteStr.length; i++) {
                      arr[i] = byteStr.charCodeAt(i);
                    }
                    return arr;
                  } else {
                    const buffer = Buffer.from(str, "base64");
                    return new Uint8Array(buffer);
                  }
                }
                exports2.base64ToBytes = base64ToBytes2;
                function bytesToBase642(arr) {
                  const intArr = arr instanceof ArrayBuffer ? new Uint8Array(arr) : arr;
                  if (typeof btoa === "function") {
                    let str = "";
                    for (let i = 0; i < intArr.length; i++) {
                      str += String.fromCharCode(intArr[i]);
                    }
                    return btoa(str);
                  } else {
                    const buffer = Buffer.from(arr);
                    return buffer.toString("base64");
                  }
                }
                exports2.bytesToBase64 = bytesToBase642;
                function hexToBytes(hex) {
                  const arr = new Uint8Array(Math.ceil(hex.length / 2));
                  for (let i = 0; i < arr.length; i++) {
                    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
                  }
                  return arr;
                }
                exports2.hexToBytes = hexToBytes;
                function bytesToHex2(arr) {
                  const intArr = arr instanceof ArrayBuffer ? new Uint8Array(arr) : arr;
                  let str = "";
                  for (let i = 0; i < intArr.length; i++) {
                    const byte = intArr[i].toString(16);
                    if (byte.length === 1) {
                      str += "0";
                    }
                    str += byte;
                  }
                  return str;
                }
                exports2.bytesToHex = bytesToHex2;
                function arrayToBuffer(arr) {
                  if (arr instanceof ArrayBuffer) {
                    return arr;
                  }
                  const ab = arr.buffer;
                  if (arr.byteOffset === 0 && arr.byteLength === ab.byteLength) {
                    return ab;
                  }
                  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
                }
                exports2.arrayToBuffer = arrayToBuffer;
                function zeroBuffer(arr) {
                  const intArr = arr instanceof ArrayBuffer ? new Uint8Array(arr) : arr;
                  intArr.fill(0);
                }
                exports2.zeroBuffer = zeroBuffer;
              })
            ),
            /***/
            "./utils/int64.ts": (
              /*!************************!*\
                !*** ./utils/int64.ts ***!
                \************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.Int64 = void 0;
                class Int64 {
                  constructor(lo = 0, hi = 0) {
                    this.lo = lo;
                    this.hi = hi;
                  }
                  get value() {
                    if (this.hi) {
                      if (this.hi >= 2097152) {
                        throw new Error("too large number");
                      }
                      return this.hi * 4294967296 + this.lo;
                    }
                    return this.lo;
                  }
                  valueOf() {
                    return this.value;
                  }
                  static from(value) {
                    if (value > 9007199254740991) {
                      throw new Error("too large number");
                    }
                    const lo = value >>> 0;
                    const hi = (value - lo) / 4294967296 >>> 0;
                    return new Int64(lo, hi);
                  }
                }
                exports2.Int64 = Int64;
              })
            ),
            /***/
            "./utils/var-dictionary.ts": (
              /*!*********************************!*\
                !*** ./utils/var-dictionary.ts ***!
                \*********************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.VarDictionary = exports2.ValueType = void 0;
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ./byte-utils */
                  "./utils/byte-utils.ts"
                );
                const int64_1 = __webpack_require__2(
                  /*! ./int64 */
                  "./utils/int64.ts"
                );
                const MaxSupportedVersion = 1;
                const DefaultVersion = 256;
                var ValueType;
                (function(ValueType2) {
                  ValueType2[ValueType2["UInt32"] = 4] = "UInt32";
                  ValueType2[ValueType2["UInt64"] = 5] = "UInt64";
                  ValueType2[ValueType2["Bool"] = 8] = "Bool";
                  ValueType2[ValueType2["Int32"] = 12] = "Int32";
                  ValueType2[ValueType2["Int64"] = 13] = "Int64";
                  ValueType2[ValueType2["String"] = 24] = "String";
                  ValueType2[ValueType2["Bytes"] = 66] = "Bytes";
                })(ValueType = exports2.ValueType || (exports2.ValueType = {}));
                class VarDictionary {
                  constructor() {
                    this._items = [];
                    this._map = /* @__PURE__ */ new Map();
                  }
                  keys() {
                    return this._items.map((item) => item.key);
                  }
                  get length() {
                    return this._items.length;
                  }
                  get(key) {
                    const item = this._map.get(key);
                    return item ? item.value : void 0;
                  }
                  set(key, type, value) {
                    let item;
                    switch (type) {
                      case ValueType.UInt32:
                        if (typeof value !== "number" || value < 0) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      case ValueType.UInt64:
                        if (!(value instanceof int64_1.Int64)) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      case ValueType.Bool:
                        if (typeof value !== "boolean") {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      case ValueType.Int32:
                        if (typeof value !== "number") {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      case ValueType.Int64:
                        if (!(value instanceof int64_1.Int64)) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      case ValueType.String:
                        if (typeof value !== "string") {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      case ValueType.Bytes:
                        if (value instanceof Uint8Array) {
                          value = (0, byte_utils_1.arrayToBuffer)(value);
                        }
                        if (!(value instanceof ArrayBuffer)) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                        }
                        item = { key, type, value };
                        break;
                      default:
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidArg);
                    }
                    const existing = this._map.get(key);
                    if (existing) {
                      const ix = this._items.indexOf(existing);
                      this._items.splice(ix, 1, item);
                    } else {
                      this._items.push(item);
                    }
                    this._map.set(key, item);
                  }
                  remove(key) {
                    this._items = this._items.filter((item) => {
                      return item.key !== key;
                    });
                    this._map.delete(key);
                  }
                  static read(stm) {
                    const dict = new VarDictionary();
                    dict.readVersion(stm);
                    for (let item; item = dict.readItem(stm); ) {
                      dict._items.push(item);
                      dict._map.set(item.key, item);
                    }
                    return dict;
                  }
                  readVersion(stm) {
                    stm.getUint8();
                    const versionMajor = stm.getUint8();
                    if (versionMajor === 0 || versionMajor > MaxSupportedVersion) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.InvalidVersion);
                    }
                  }
                  readItem(stm) {
                    const type = stm.getUint8();
                    if (!type) {
                      return void 0;
                    }
                    const keyLength = stm.getInt32(true);
                    if (keyLength <= 0) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad key length");
                    }
                    const key = (0, byte_utils_1.bytesToString)(stm.readBytes(keyLength));
                    const valueLength = stm.getInt32(true);
                    if (valueLength < 0) {
                      throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad value length");
                    }
                    switch (type) {
                      case ValueType.UInt32: {
                        if (valueLength !== 4) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad uint32");
                        }
                        const value = stm.getUint32(true);
                        return { key, type, value };
                      }
                      case ValueType.UInt64: {
                        if (valueLength !== 8) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad uint64");
                        }
                        const loInt = stm.getUint32(true);
                        const hiInt = stm.getUint32(true);
                        const value = new int64_1.Int64(loInt, hiInt);
                        return { key, type, value };
                      }
                      case ValueType.Bool: {
                        if (valueLength !== 1) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad bool");
                        }
                        const value = stm.getUint8() !== 0;
                        return { key, type, value };
                      }
                      case ValueType.Int32: {
                        if (valueLength !== 4) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad int32");
                        }
                        const value = stm.getInt32(true);
                        return { key, type, value };
                      }
                      case ValueType.Int64: {
                        if (valueLength !== 8) {
                          throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad int64");
                        }
                        const loUint = stm.getUint32(true);
                        const hiUint = stm.getUint32(true);
                        const value = new int64_1.Int64(loUint, hiUint);
                        return { key, type, value };
                      }
                      case ValueType.String: {
                        const value = (0, byte_utils_1.bytesToString)(stm.readBytes(valueLength));
                        return { key, type, value };
                      }
                      case ValueType.Bytes: {
                        const value = stm.readBytes(valueLength);
                        return { key, type, value };
                      }
                      default:
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, `bad value type: ${type}`);
                    }
                  }
                  write(stm) {
                    this.writeVersion(stm);
                    for (const item of this._items) {
                      this.writeItem(stm, item);
                    }
                    stm.setUint8(0);
                  }
                  writeVersion(stm) {
                    stm.setUint16(DefaultVersion, true);
                  }
                  writeItem(stm, item) {
                    stm.setUint8(item.type);
                    const keyBytes = (0, byte_utils_1.stringToBytes)(item.key);
                    stm.setInt32(keyBytes.length, true);
                    stm.writeBytes(keyBytes);
                    switch (item.type) {
                      case ValueType.UInt32:
                        stm.setInt32(4, true);
                        stm.setUint32(item.value, true);
                        break;
                      case ValueType.UInt64:
                        stm.setInt32(8, true);
                        stm.setUint32(item.value.lo, true);
                        stm.setUint32(item.value.hi, true);
                        break;
                      case ValueType.Bool:
                        stm.setInt32(1, true);
                        stm.setUint8(item.value ? 1 : 0);
                        break;
                      case ValueType.Int32:
                        stm.setInt32(4, true);
                        stm.setInt32(item.value, true);
                        break;
                      case ValueType.Int64:
                        stm.setInt32(8, true);
                        stm.setUint32(item.value.lo, true);
                        stm.setUint32(item.value.hi, true);
                        break;
                      case ValueType.String: {
                        const strBytes = (0, byte_utils_1.stringToBytes)(item.value);
                        stm.setInt32(strBytes.length, true);
                        stm.writeBytes(strBytes);
                        break;
                      }
                      case ValueType.Bytes: {
                        const bytesBuffer = (0, byte_utils_1.arrayToBuffer)(item.value);
                        stm.setInt32(bytesBuffer.byteLength, true);
                        stm.writeBytes(bytesBuffer);
                        break;
                      }
                      default:
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.Unsupported);
                    }
                  }
                }
                exports2.VarDictionary = VarDictionary;
                VarDictionary.ValueType = ValueType;
              })
            ),
            /***/
            "./utils/xml-utils.ts": (
              /*!****************************!*\
                !*** ./utils/xml-utils.ts ***!
                \****************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                Object.defineProperty(exports2, "__esModule", { value: true });
                exports2.protectPlainValues = exports2.protectUnprotectedValues = exports2.unprotectValues = exports2.updateProtectedValuesSalt = exports2.setProtectedValues = exports2.traverse = exports2.setProtectedBinary = exports2.getProtectedBinary = exports2.setProtectedText = exports2.getProtectedText = exports2.setUuid = exports2.getUuid = exports2.strToBoolean = exports2.setBoolean = exports2.getBoolean = exports2.setNumber = exports2.getNumber = exports2.setDate = exports2.getDate = exports2.setBytes = exports2.getBytes = exports2.setTags = exports2.getTags = exports2.setText = exports2.getText = exports2.addChildNode = exports2.getChildNode = exports2.create = exports2.serialize = exports2.parse = void 0;
                const fflate_1 = __webpack_require__2(
                  /*! fflate */
                  "../node_modules/fflate/lib/index.cjs"
                );
                const kdbx_error_1 = __webpack_require__2(
                  /*! ../errors/kdbx-error */
                  "./errors/kdbx-error.ts"
                );
                const consts_1 = __webpack_require__2(
                  /*! ../defs/consts */
                  "./defs/consts.ts"
                );
                const XmlNames = __webpack_require__2(
                  /*! ../defs/xml-names */
                  "./defs/xml-names.ts"
                );
                const byte_utils_1 = __webpack_require__2(
                  /*! ./byte-utils */
                  "./utils/byte-utils.ts"
                );
                const int64_1 = __webpack_require__2(
                  /*! ./int64 */
                  "./utils/int64.ts"
                );
                const kdbx_uuid_1 = __webpack_require__2(
                  /*! ../format/kdbx-uuid */
                  "./format/kdbx-uuid.ts"
                );
                const protected_value_1 = __webpack_require__2(
                  /*! ../crypto/protected-value */
                  "./crypto/protected-value.ts"
                );
                const kdbx_binaries_1 = __webpack_require__2(
                  /*! ../format/kdbx-binaries */
                  "./format/kdbx-binaries.ts"
                );
                const DateRegex = /\.\d\d\d/;
                const EpochSeconds = 62135596800;
                const TagsSplitRegex = /\s*[;,:]\s*/;
                function createDOMParser() {
                  if (__webpack_require__2.g.DOMParser) {
                    return new __webpack_require__2.g.DOMParser();
                  }
                  const parserArg = {
                    errorHandler: {
                      warning: (e) => {
                        throw e;
                      },
                      error: (e) => {
                        throw e;
                      },
                      fatalError: (e) => {
                        throw e;
                      }
                    }
                  };
                  const { DOMParser: DOMParser2 } = __webpack_require__2(
                    /*! @xmldom/xmldom */
                    "@xmldom/xmldom"
                  );
                  return new DOMParser2(parserArg);
                }
                function createXMLSerializer() {
                  if (__webpack_require__2.g.XMLSerializer) {
                    return new __webpack_require__2.g.XMLSerializer();
                  }
                  const { XMLSerializer: XMLSerializer2 } = __webpack_require__2(
                    /*! @xmldom/xmldom */
                    "@xmldom/xmldom"
                  );
                  return new XMLSerializer2();
                }
                function parse(xml) {
                  const parser = createDOMParser();
                  let doc;
                  xml = xml.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, "");
                  try {
                    doc = parser.parseFromString(xml, "application/xml");
                  } catch (e) {
                    const errMsg = e instanceof Error ? e.message : String(e);
                    throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, `bad xml: ${errMsg}`);
                  }
                  if (!doc.documentElement) {
                    throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, "bad xml");
                  }
                  const parserError = doc.getElementsByTagName("parsererror")[0];
                  if (parserError) {
                    throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, `bad xml: ${parserError.textContent}`);
                  }
                  return doc;
                }
                exports2.parse = parse;
                function serialize(doc, prettyPrint = false) {
                  if (prettyPrint) {
                    prettyPrintXmlNode(doc, 0);
                  }
                  let xml = createXMLSerializer().serializeToString(doc);
                  if (prettyPrint && xml.startsWith("<?")) {
                    xml = xml.replace(/^(<\?.*?\?>)</, "$1\n<");
                  }
                  return xml;
                }
                exports2.serialize = serialize;
                function prettyPrintXmlNode(node, indentationLevel) {
                  const numChildNodes = node.childNodes.length;
                  if (numChildNodes === 0) {
                    return;
                  }
                  const formatStr = "\n" + "    ".repeat(indentationLevel);
                  const prevFormatStr = indentationLevel > 0 ? "\n" + "    ".repeat(indentationLevel - 1) : "";
                  const doc = node.ownerDocument || node;
                  const childNodes = [];
                  let childNode;
                  for (let i = 0; i < numChildNodes; i++) {
                    childNode = node.childNodes[i];
                    if (childNode.nodeType !== doc.TEXT_NODE && childNode.nodeType !== doc.PROCESSING_INSTRUCTION_NODE) {
                      childNodes.push(childNode);
                    }
                  }
                  for (let j = 0; j < childNodes.length; j++) {
                    childNode = childNodes[j];
                    const isFirstDocumentNode = indentationLevel === 0 && j === 0;
                    if (!isFirstDocumentNode) {
                      const textNodeBefore = doc.createTextNode(formatStr);
                      node.insertBefore(textNodeBefore, childNode);
                    }
                    if (!childNode.nextSibling && indentationLevel > 0) {
                      const textNodeAfter = doc.createTextNode(prevFormatStr);
                      node.appendChild(textNodeAfter);
                    }
                    prettyPrintXmlNode(childNode, indentationLevel + 1);
                  }
                }
                function create(rootNode) {
                  return parse('<?xml version="1.0" encoding="utf-8" standalone="yes"?><' + rootNode + "/>");
                }
                exports2.create = create;
                function getChildNode(node, tagName, errorMsgIfAbsent) {
                  if (node && node.childNodes) {
                    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                      if (cn[i].tagName === tagName) {
                        return cn[i];
                      }
                    }
                  }
                  if (errorMsgIfAbsent) {
                    throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, errorMsgIfAbsent);
                  } else {
                    return null;
                  }
                }
                exports2.getChildNode = getChildNode;
                function addChildNode(node, tagName) {
                  return node.appendChild((node.ownerDocument || node).createElement(tagName));
                }
                exports2.addChildNode = addChildNode;
                function getText(node) {
                  var _a;
                  if (!(node === null || node === void 0 ? void 0 : node.childNodes)) {
                    return void 0;
                  }
                  return node.protectedValue ? node.protectedValue.getText() : (_a = node.textContent) !== null && _a !== void 0 ? _a : void 0;
                }
                exports2.getText = getText;
                function setText(node, text) {
                  node.textContent = text || "";
                }
                exports2.setText = setText;
                function getTags(node) {
                  const text = getText(node);
                  if (!text) {
                    return [];
                  }
                  return text.split(TagsSplitRegex).map((t) => t.trim()).filter((s) => s);
                }
                exports2.getTags = getTags;
                function setTags(node, tags) {
                  setText(node, tags.join(", "));
                }
                exports2.setTags = setTags;
                function getBytes(node) {
                  const text = getText(node);
                  return text ? (0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.base64ToBytes)(text)) : void 0;
                }
                exports2.getBytes = getBytes;
                function setBytes(node, bytes) {
                  if (typeof bytes === "string") {
                    bytes = (0, byte_utils_1.base64ToBytes)(bytes);
                  }
                  setText(node, bytes ? (0, byte_utils_1.bytesToBase64)((0, byte_utils_1.arrayToBuffer)(bytes)) : void 0);
                }
                exports2.setBytes = setBytes;
                function getDate(node) {
                  const text = getText(node);
                  if (!text) {
                    return void 0;
                  }
                  if (text.indexOf(":") > 0) {
                    return new Date(text);
                  }
                  const bytes = new DataView((0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.base64ToBytes)(text)));
                  const secondsFrom00 = new int64_1.Int64(bytes.getUint32(0, true), bytes.getUint32(4, true)).value;
                  const diff = (secondsFrom00 - EpochSeconds) * 1e3;
                  return new Date(diff);
                }
                exports2.getDate = getDate;
                function setDate(node, date, binary = false) {
                  if (date) {
                    if (binary) {
                      const secondsFrom00 = Math.floor(date.getTime() / 1e3) + EpochSeconds;
                      const bytes = new DataView(new ArrayBuffer(8));
                      const val64 = int64_1.Int64.from(secondsFrom00);
                      bytes.setUint32(0, val64.lo, true);
                      bytes.setUint32(4, val64.hi, true);
                      setText(node, (0, byte_utils_1.bytesToBase64)(bytes.buffer));
                    } else {
                      setText(node, date.toISOString().replace(DateRegex, ""));
                    }
                  } else {
                    setText(node, "");
                  }
                }
                exports2.setDate = setDate;
                function getNumber(node) {
                  const text = getText(node);
                  return text ? +text : void 0;
                }
                exports2.getNumber = getNumber;
                function setNumber(node, number) {
                  setText(node, typeof number === "number" && !isNaN(number) ? number.toString() : void 0);
                }
                exports2.setNumber = setNumber;
                function getBoolean(node) {
                  const text = getText(node);
                  return text ? strToBoolean(text) : void 0;
                }
                exports2.getBoolean = getBoolean;
                function setBoolean(node, boolean) {
                  setText(node, boolean === void 0 ? "" : boolean === null ? "null" : boolean ? "True" : "False");
                }
                exports2.setBoolean = setBoolean;
                function strToBoolean(str) {
                  switch (str === null || str === void 0 ? void 0 : str.toLowerCase()) {
                    case "true":
                      return true;
                    case "false":
                      return false;
                    case "null":
                      return null;
                  }
                  return void 0;
                }
                exports2.strToBoolean = strToBoolean;
                function getUuid(node) {
                  const bytes = getBytes(node);
                  return bytes ? new kdbx_uuid_1.KdbxUuid(bytes) : void 0;
                }
                exports2.getUuid = getUuid;
                function setUuid(node, uuid) {
                  const uuidBytes = uuid instanceof kdbx_uuid_1.KdbxUuid ? uuid.toBytes() : uuid;
                  setBytes(node, uuidBytes);
                }
                exports2.setUuid = setUuid;
                function getProtectedText(node) {
                  var _a;
                  return (_a = node.protectedValue || node.textContent) !== null && _a !== void 0 ? _a : void 0;
                }
                exports2.getProtectedText = getProtectedText;
                function setProtectedText(node, text) {
                  if (text instanceof protected_value_1.ProtectedValue) {
                    node.protectedValue = text;
                    node.setAttribute(XmlNames.Attr.Protected, "True");
                  } else {
                    setText(node, text);
                  }
                }
                exports2.setProtectedText = setProtectedText;
                function getProtectedBinary(node) {
                  if (node.protectedValue) {
                    return node.protectedValue;
                  }
                  const text = node.textContent;
                  const ref = node.getAttribute(XmlNames.Attr.Ref);
                  if (ref) {
                    return { ref };
                  }
                  if (!text) {
                    return void 0;
                  }
                  const compressed = strToBoolean(node.getAttribute(XmlNames.Attr.Compressed));
                  let bytes = (0, byte_utils_1.base64ToBytes)(text);
                  if (compressed) {
                    bytes = (0, fflate_1.gunzipSync)(bytes);
                  }
                  return (0, byte_utils_1.arrayToBuffer)(bytes);
                }
                exports2.getProtectedBinary = getProtectedBinary;
                function setProtectedBinary(node, binary) {
                  if (binary instanceof protected_value_1.ProtectedValue) {
                    node.protectedValue = binary;
                    node.setAttribute(XmlNames.Attr.Protected, "True");
                  } else if (kdbx_binaries_1.KdbxBinaries.isKdbxBinaryRef(binary)) {
                    node.setAttribute(XmlNames.Attr.Ref, binary.ref);
                  } else {
                    setBytes(node, binary);
                  }
                }
                exports2.setProtectedBinary = setProtectedBinary;
                function traverse(node, callback) {
                  callback(node);
                  for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
                    const childNode = cn[i];
                    if (childNode.tagName) {
                      traverse(childNode, callback);
                    }
                  }
                }
                exports2.traverse = traverse;
                function setProtectedValues(node, protectSaltGenerator) {
                  traverse(node, (node2) => {
                    if (strToBoolean(node2.getAttribute(XmlNames.Attr.Protected))) {
                      try {
                        const value = (0, byte_utils_1.arrayToBuffer)((0, byte_utils_1.base64ToBytes)(node2.textContent || ""));
                        if (value.byteLength) {
                          const salt = protectSaltGenerator.getSalt(value.byteLength);
                          node2.protectedValue = new protected_value_1.ProtectedValue(value, salt);
                        }
                      } catch (e) {
                        throw new kdbx_error_1.KdbxError(consts_1.ErrorCodes.FileCorrupt, `bad protected value at line ${node2.lineNumber}: ${e}`);
                      }
                    }
                  });
                }
                exports2.setProtectedValues = setProtectedValues;
                function updateProtectedValuesSalt(node, protectSaltGenerator) {
                  traverse(node, (node2) => {
                    if (strToBoolean(node2.getAttribute(XmlNames.Attr.Protected)) && node2.protectedValue) {
                      const newSalt = protectSaltGenerator.getSalt(node2.protectedValue.byteLength);
                      node2.protectedValue.setSalt(newSalt);
                      node2.textContent = node2.protectedValue.toString();
                    }
                  });
                }
                exports2.updateProtectedValuesSalt = updateProtectedValuesSalt;
                function unprotectValues(node) {
                  traverse(node, (node2) => {
                    if (strToBoolean(node2.getAttribute(XmlNames.Attr.Protected)) && node2.protectedValue) {
                      node2.removeAttribute(XmlNames.Attr.Protected);
                      node2.setAttribute(XmlNames.Attr.ProtectedInMemPlainXml, "True");
                      node2.textContent = node2.protectedValue.getText();
                    }
                  });
                }
                exports2.unprotectValues = unprotectValues;
                function protectUnprotectedValues(node) {
                  traverse(node, (node2) => {
                    if (strToBoolean(node2.getAttribute(XmlNames.Attr.ProtectedInMemPlainXml)) && node2.protectedValue) {
                      node2.removeAttribute(XmlNames.Attr.ProtectedInMemPlainXml);
                      node2.setAttribute(XmlNames.Attr.Protected, "True");
                      node2.textContent = node2.protectedValue.toString();
                    }
                  });
                }
                exports2.protectUnprotectedValues = protectUnprotectedValues;
                function protectPlainValues(node) {
                  traverse(node, (node2) => {
                    if (strToBoolean(node2.getAttribute(XmlNames.Attr.ProtectedInMemPlainXml))) {
                      node2.protectedValue = protected_value_1.ProtectedValue.fromString(node2.textContent || "");
                      node2.textContent = node2.protectedValue.toString();
                      node2.removeAttribute(XmlNames.Attr.ProtectedInMemPlainXml);
                      node2.setAttribute(XmlNames.Attr.Protected, "True");
                    }
                  });
                }
                exports2.protectPlainValues = protectPlainValues;
              })
            ),
            /***/
            "@xmldom/xmldom": (
              /*!*********************************!*\
                !*** external "@xmldom/xmldom" ***!
                \*********************************/
              /***/
              ((module2) => {
                module2.exports = __WEBPACK_EXTERNAL_MODULE__xmldom_xmldom__;
              })
            ),
            /***/
            "crypto": (
              /*!*************************!*\
                !*** external "crypto" ***!
                \*************************/
              /***/
              ((module2) => {
                module2.exports = __WEBPACK_EXTERNAL_MODULE_crypto__;
              })
            ),
            /***/
            "../node_modules/fflate/lib/index.cjs": (
              /*!********************************************!*\
                !*** ../node_modules/fflate/lib/index.cjs ***!
                \********************************************/
              /***/
              ((__unused_webpack_module, exports2, __webpack_require__2) => {
                var node_worker_1 = __webpack_require__2(
                  /*! ./node-worker.cjs */
                  "../node_modules/fflate/lib/worker.cjs"
                );
                var u82 = Uint8Array, u16 = Uint16Array, u322 = Uint32Array;
                var fleb = new u82([
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  1,
                  1,
                  1,
                  1,
                  2,
                  2,
                  2,
                  2,
                  3,
                  3,
                  3,
                  3,
                  4,
                  4,
                  4,
                  4,
                  5,
                  5,
                  5,
                  5,
                  0,
                  /* unused */
                  0,
                  0,
                  /* impossible */
                  0
                ]);
                var fdeb = new u82([
                  0,
                  0,
                  0,
                  0,
                  1,
                  1,
                  2,
                  2,
                  3,
                  3,
                  4,
                  4,
                  5,
                  5,
                  6,
                  6,
                  7,
                  7,
                  8,
                  8,
                  9,
                  9,
                  10,
                  10,
                  11,
                  11,
                  12,
                  12,
                  13,
                  13,
                  /* unused */
                  0,
                  0
                ]);
                var clim = new u82([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
                var freb = function(eb, start) {
                  var b = new u16(31);
                  for (var i2 = 0; i2 < 31; ++i2) {
                    b[i2] = start += 1 << eb[i2 - 1];
                  }
                  var r = new u322(b[30]);
                  for (var i2 = 1; i2 < 30; ++i2) {
                    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
                      r[j] = j - b[i2] << 5 | i2;
                    }
                  }
                  return [b, r];
                };
                var _a = freb(fleb, 2), fl = _a[0], revfl = _a[1];
                fl[28] = 258, revfl[258] = 28;
                var _b = freb(fdeb, 0), fd = _b[0], revfd = _b[1];
                var rev = new u16(32768);
                for (var i = 0; i < 32768; ++i) {
                  var x = (i & 43690) >>> 1 | (i & 21845) << 1;
                  x = (x & 52428) >>> 2 | (x & 13107) << 2;
                  x = (x & 61680) >>> 4 | (x & 3855) << 4;
                  rev[i] = ((x & 65280) >>> 8 | (x & 255) << 8) >>> 1;
                }
                var hMap = (function(cd, mb, r) {
                  var s = cd.length;
                  var i2 = 0;
                  var l = new u16(mb);
                  for (; i2 < s; ++i2)
                    ++l[cd[i2] - 1];
                  var le = new u16(mb);
                  for (i2 = 0; i2 < mb; ++i2) {
                    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
                  }
                  var co;
                  if (r) {
                    co = new u16(1 << mb);
                    var rvb = 15 - mb;
                    for (i2 = 0; i2 < s; ++i2) {
                      if (cd[i2]) {
                        var sv = i2 << 4 | cd[i2];
                        var r_1 = mb - cd[i2];
                        var v = le[cd[i2] - 1]++ << r_1;
                        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
                          co[rev[v] >>> rvb] = sv;
                        }
                      }
                    }
                  } else {
                    co = new u16(s);
                    for (i2 = 0; i2 < s; ++i2) {
                      if (cd[i2]) {
                        co[i2] = rev[le[cd[i2] - 1]++] >>> 15 - cd[i2];
                      }
                    }
                  }
                  return co;
                });
                var flt = new u82(288);
                for (var i = 0; i < 144; ++i)
                  flt[i] = 8;
                for (var i = 144; i < 256; ++i)
                  flt[i] = 9;
                for (var i = 256; i < 280; ++i)
                  flt[i] = 7;
                for (var i = 280; i < 288; ++i)
                  flt[i] = 8;
                var fdt = new u82(32);
                for (var i = 0; i < 32; ++i)
                  fdt[i] = 5;
                var flm = /* @__PURE__ */ hMap(flt, 9, 0), flrm = /* @__PURE__ */ hMap(flt, 9, 1);
                var fdm = /* @__PURE__ */ hMap(fdt, 5, 0), fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
                var max = function(a) {
                  var m = a[0];
                  for (var i2 = 1; i2 < a.length; ++i2) {
                    if (a[i2] > m)
                      m = a[i2];
                  }
                  return m;
                };
                var bits = function(d, p, m) {
                  var o = p / 8 | 0;
                  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
                };
                var bits16 = function(d, p) {
                  var o = p / 8 | 0;
                  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
                };
                var shft = function(p) {
                  return (p + 7) / 8 | 0;
                };
                var slc = function(v, s, e) {
                  if (s == null || s < 0)
                    s = 0;
                  if (e == null || e > v.length)
                    e = v.length;
                  var n = new (v instanceof u16 ? u16 : v instanceof u322 ? u322 : u82)(e - s);
                  n.set(v.subarray(s, e));
                  return n;
                };
                exports2.FlateErrorCode = {
                  UnexpectedEOF: 0,
                  InvalidBlockType: 1,
                  InvalidLengthLiteral: 2,
                  InvalidDistance: 3,
                  StreamFinished: 4,
                  NoStreamHandler: 5,
                  InvalidHeader: 6,
                  NoCallback: 7,
                  InvalidUTF8: 8,
                  ExtraFieldTooLong: 9,
                  InvalidDate: 10,
                  FilenameTooLong: 11,
                  StreamFinishing: 12,
                  InvalidZipData: 13,
                  UnknownCompressionMethod: 14
                };
                var ec = [
                  "unexpected EOF",
                  "invalid block type",
                  "invalid length/literal",
                  "invalid distance",
                  "stream finished",
                  "no stream handler",
                  ,
                  "no callback",
                  "invalid UTF-8 data",
                  "extra field too long",
                  "date not in range 1980-2099",
                  "filename too long",
                  "stream finishing",
                  "invalid zip data"
                  // determined by unknown compression method
                ];
                ;
                var err = function(ind, msg, nt) {
                  var e = new Error(msg || ec[ind]);
                  e.code = ind;
                  if (Error.captureStackTrace)
                    Error.captureStackTrace(e, err);
                  if (!nt)
                    throw e;
                  return e;
                };
                var inflt = function(dat, buf, st) {
                  var sl = dat.length;
                  if (!sl || st && st.f && !st.l)
                    return buf || new u82(0);
                  var noBuf = !buf || st;
                  var noSt = !st || st.i;
                  if (!st)
                    st = {};
                  if (!buf)
                    buf = new u82(sl * 3);
                  var cbuf = function(l2) {
                    var bl = buf.length;
                    if (l2 > bl) {
                      var nbuf = new u82(Math.max(bl * 2, l2));
                      nbuf.set(buf);
                      buf = nbuf;
                    }
                  };
                  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
                  var tbts = sl * 8;
                  do {
                    if (!lm) {
                      final = bits(dat, pos, 1);
                      var type = bits(dat, pos + 1, 3);
                      pos += 3;
                      if (!type) {
                        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
                        if (t > sl) {
                          if (noSt)
                            err(0);
                          break;
                        }
                        if (noBuf)
                          cbuf(bt + l);
                        buf.set(dat.subarray(s, t), bt);
                        st.b = bt += l, st.p = pos = t * 8, st.f = final;
                        continue;
                      } else if (type == 1)
                        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
                      else if (type == 2) {
                        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
                        var tl = hLit + bits(dat, pos + 5, 31) + 1;
                        pos += 14;
                        var ldt = new u82(tl);
                        var clt = new u82(19);
                        for (var i2 = 0; i2 < hcLen; ++i2) {
                          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
                        }
                        pos += hcLen * 3;
                        var clb = max(clt), clbmsk = (1 << clb) - 1;
                        var clm = hMap(clt, clb, 1);
                        for (var i2 = 0; i2 < tl; ) {
                          var r = clm[bits(dat, pos, clbmsk)];
                          pos += r & 15;
                          var s = r >>> 4;
                          if (s < 16) {
                            ldt[i2++] = s;
                          } else {
                            var c = 0, n = 0;
                            if (s == 16)
                              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
                            else if (s == 17)
                              n = 3 + bits(dat, pos, 7), pos += 3;
                            else if (s == 18)
                              n = 11 + bits(dat, pos, 127), pos += 7;
                            while (n--)
                              ldt[i2++] = c;
                          }
                        }
                        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
                        lbt = max(lt);
                        dbt = max(dt);
                        lm = hMap(lt, lbt, 1);
                        dm = hMap(dt, dbt, 1);
                      } else
                        err(1);
                      if (pos > tbts) {
                        if (noSt)
                          err(0);
                        break;
                      }
                    }
                    if (noBuf)
                      cbuf(bt + 131072);
                    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
                    var lpos = pos;
                    for (; ; lpos = pos) {
                      var c = lm[bits16(dat, pos) & lms], sym = c >>> 4;
                      pos += c & 15;
                      if (pos > tbts) {
                        if (noSt)
                          err(0);
                        break;
                      }
                      if (!c)
                        err(2);
                      if (sym < 256)
                        buf[bt++] = sym;
                      else if (sym == 256) {
                        lpos = pos, lm = null;
                        break;
                      } else {
                        var add2 = sym - 254;
                        if (sym > 264) {
                          var i2 = sym - 257, b = fleb[i2];
                          add2 = bits(dat, pos, (1 << b) - 1) + fl[i2];
                          pos += b;
                        }
                        var d = dm[bits16(dat, pos) & dms], dsym = d >>> 4;
                        if (!d)
                          err(3);
                        pos += d & 15;
                        var dt = fd[dsym];
                        if (dsym > 3) {
                          var b = fdeb[dsym];
                          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
                        }
                        if (pos > tbts) {
                          if (noSt)
                            err(0);
                          break;
                        }
                        if (noBuf)
                          cbuf(bt + 131072);
                        var end = bt + add2;
                        for (; bt < end; bt += 4) {
                          buf[bt] = buf[bt - dt];
                          buf[bt + 1] = buf[bt + 1 - dt];
                          buf[bt + 2] = buf[bt + 2 - dt];
                          buf[bt + 3] = buf[bt + 3 - dt];
                        }
                        bt = end;
                      }
                    }
                    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
                    if (lm)
                      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
                  } while (!final);
                  return bt == buf.length ? buf : slc(buf, 0, bt);
                };
                var wbits = function(d, p, v) {
                  v <<= p & 7;
                  var o = p / 8 | 0;
                  d[o] |= v;
                  d[o + 1] |= v >>> 8;
                };
                var wbits16 = function(d, p, v) {
                  v <<= p & 7;
                  var o = p / 8 | 0;
                  d[o] |= v;
                  d[o + 1] |= v >>> 8;
                  d[o + 2] |= v >>> 16;
                };
                var hTree = function(d, mb) {
                  var t = [];
                  for (var i2 = 0; i2 < d.length; ++i2) {
                    if (d[i2])
                      t.push({ s: i2, f: d[i2] });
                  }
                  var s = t.length;
                  var t2 = t.slice();
                  if (!s)
                    return [et, 0];
                  if (s == 1) {
                    var v = new u82(t[0].s + 1);
                    v[t[0].s] = 1;
                    return [v, 1];
                  }
                  t.sort(function(a, b) {
                    return a.f - b.f;
                  });
                  t.push({ s: -1, f: 25001 });
                  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
                  t[0] = { s: -1, f: l.f + r.f, l, r };
                  while (i1 != s - 1) {
                    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
                    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
                    t[i1++] = { s: -1, f: l.f + r.f, l, r };
                  }
                  var maxSym = t2[0].s;
                  for (var i2 = 1; i2 < s; ++i2) {
                    if (t2[i2].s > maxSym)
                      maxSym = t2[i2].s;
                  }
                  var tr = new u16(maxSym + 1);
                  var mbt = ln(t[i1 - 1], tr, 0);
                  if (mbt > mb) {
                    var i2 = 0, dt = 0;
                    var lft = mbt - mb, cst = 1 << lft;
                    t2.sort(function(a, b) {
                      return tr[b.s] - tr[a.s] || a.f - b.f;
                    });
                    for (; i2 < s; ++i2) {
                      var i2_1 = t2[i2].s;
                      if (tr[i2_1] > mb) {
                        dt += cst - (1 << mbt - tr[i2_1]);
                        tr[i2_1] = mb;
                      } else
                        break;
                    }
                    dt >>>= lft;
                    while (dt > 0) {
                      var i2_2 = t2[i2].s;
                      if (tr[i2_2] < mb)
                        dt -= 1 << mb - tr[i2_2]++ - 1;
                      else
                        ++i2;
                    }
                    for (; i2 >= 0 && dt; --i2) {
                      var i2_3 = t2[i2].s;
                      if (tr[i2_3] == mb) {
                        --tr[i2_3];
                        ++dt;
                      }
                    }
                    mbt = mb;
                  }
                  return [new u82(tr), mbt];
                };
                var ln = function(n, l, d) {
                  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
                };
                var lc = function(c) {
                  var s = c.length;
                  while (s && !c[--s])
                    ;
                  var cl = new u16(++s);
                  var cli = 0, cln = c[0], cls = 1;
                  var w = function(v) {
                    cl[cli++] = v;
                  };
                  for (var i2 = 1; i2 <= s; ++i2) {
                    if (c[i2] == cln && i2 != s)
                      ++cls;
                    else {
                      if (!cln && cls > 2) {
                        for (; cls > 138; cls -= 138)
                          w(32754);
                        if (cls > 2) {
                          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
                          cls = 0;
                        }
                      } else if (cls > 3) {
                        w(cln), --cls;
                        for (; cls > 6; cls -= 6)
                          w(8304);
                        if (cls > 2)
                          w(cls - 3 << 5 | 8208), cls = 0;
                      }
                      while (cls--)
                        w(cln);
                      cls = 1;
                      cln = c[i2];
                    }
                  }
                  return [cl.subarray(0, cli), s];
                };
                var clen = function(cf, cl) {
                  var l = 0;
                  for (var i2 = 0; i2 < cl.length; ++i2)
                    l += cf[i2] * cl[i2];
                  return l;
                };
                var wfblk = function(out, pos, dat) {
                  var s = dat.length;
                  var o = shft(pos + 2);
                  out[o] = s & 255;
                  out[o + 1] = s >>> 8;
                  out[o + 2] = out[o] ^ 255;
                  out[o + 3] = out[o + 1] ^ 255;
                  for (var i2 = 0; i2 < s; ++i2)
                    out[o + i2 + 4] = dat[i2];
                  return (o + 4 + s) * 8;
                };
                var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
                  wbits(out, p++, final);
                  ++lf[256];
                  var _a2 = hTree(lf, 15), dlt = _a2[0], mlb = _a2[1];
                  var _b2 = hTree(df, 15), ddt = _b2[0], mdb = _b2[1];
                  var _c = lc(dlt), lclt = _c[0], nlc = _c[1];
                  var _d = lc(ddt), lcdt = _d[0], ndc = _d[1];
                  var lcfreq = new u16(19);
                  for (var i2 = 0; i2 < lclt.length; ++i2)
                    lcfreq[lclt[i2] & 31]++;
                  for (var i2 = 0; i2 < lcdt.length; ++i2)
                    lcfreq[lcdt[i2] & 31]++;
                  var _e = hTree(lcfreq, 7), lct = _e[0], mlcb = _e[1];
                  var nlcc = 19;
                  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
                    ;
                  var flen = bl + 5 << 3;
                  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
                  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + (2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18]);
                  if (flen <= ftlen && flen <= dtlen)
                    return wfblk(out, p, dat.subarray(bs, bs + bl));
                  var lm, ll, dm, dl;
                  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
                  if (dtlen < ftlen) {
                    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
                    var llm = hMap(lct, mlcb, 0);
                    wbits(out, p, nlc - 257);
                    wbits(out, p + 5, ndc - 1);
                    wbits(out, p + 10, nlcc - 4);
                    p += 14;
                    for (var i2 = 0; i2 < nlcc; ++i2)
                      wbits(out, p + 3 * i2, lct[clim[i2]]);
                    p += 3 * nlcc;
                    var lcts = [lclt, lcdt];
                    for (var it = 0; it < 2; ++it) {
                      var clct = lcts[it];
                      for (var i2 = 0; i2 < clct.length; ++i2) {
                        var len = clct[i2] & 31;
                        wbits(out, p, llm[len]), p += lct[len];
                        if (len > 15)
                          wbits(out, p, clct[i2] >>> 5 & 127), p += clct[i2] >>> 12;
                      }
                    }
                  } else {
                    lm = flm, ll = flt, dm = fdm, dl = fdt;
                  }
                  for (var i2 = 0; i2 < li; ++i2) {
                    if (syms[i2] > 255) {
                      var len = syms[i2] >>> 18 & 31;
                      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
                      if (len > 7)
                        wbits(out, p, syms[i2] >>> 23 & 31), p += fleb[len];
                      var dst = syms[i2] & 31;
                      wbits16(out, p, dm[dst]), p += dl[dst];
                      if (dst > 3)
                        wbits16(out, p, syms[i2] >>> 5 & 8191), p += fdeb[dst];
                    } else {
                      wbits16(out, p, lm[syms[i2]]), p += ll[syms[i2]];
                    }
                  }
                  wbits16(out, p, lm[256]);
                  return p + ll[256];
                };
                var deo = /* @__PURE__ */ new u322([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
                var et = /* @__PURE__ */ new u82(0);
                var dflt = function(dat, lvl, plvl, pre, post, lst) {
                  var s = dat.length;
                  var o = new u82(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
                  var w = o.subarray(pre, o.length - post);
                  var pos = 0;
                  if (!lvl || s < 8) {
                    for (var i2 = 0; i2 <= s; i2 += 65535) {
                      var e = i2 + 65535;
                      if (e < s) {
                        pos = wfblk(w, pos, dat.subarray(i2, e));
                      } else {
                        w[i2] = lst;
                        pos = wfblk(w, pos, dat.subarray(i2, s));
                      }
                    }
                  } else {
                    var opt = deo[lvl - 1];
                    var n = opt >>> 13, c = opt & 8191;
                    var msk_1 = (1 << plvl) - 1;
                    var prev = new u16(32768), head = new u16(msk_1 + 1);
                    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
                    var hsh = function(i3) {
                      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
                    };
                    var syms = new u322(25e3);
                    var lf = new u16(288), df = new u16(32);
                    var lc_1 = 0, eb = 0, i2 = 0, li = 0, wi = 0, bs = 0;
                    for (; i2 < s; ++i2) {
                      var hv = hsh(i2);
                      var imod = i2 & 32767, pimod = head[hv];
                      prev[imod] = pimod;
                      head[hv] = imod;
                      if (wi <= i2) {
                        var rem = s - i2;
                        if ((lc_1 > 7e3 || li > 24576) && rem > 423) {
                          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
                          li = lc_1 = eb = 0, bs = i2;
                          for (var j = 0; j < 286; ++j)
                            lf[j] = 0;
                          for (var j = 0; j < 30; ++j)
                            df[j] = 0;
                        }
                        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
                        if (rem > 2 && hv == hsh(i2 - dif)) {
                          var maxn = Math.min(n, rem) - 1;
                          var maxd = Math.min(32767, i2);
                          var ml = Math.min(258, rem);
                          while (dif <= maxd && --ch_1 && imod != pimod) {
                            if (dat[i2 + l] == dat[i2 + l - dif]) {
                              var nl = 0;
                              for (; nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                                ;
                              if (nl > l) {
                                l = nl, d = dif;
                                if (nl > maxn)
                                  break;
                                var mmd = Math.min(dif, nl - 2);
                                var md = 0;
                                for (var j = 0; j < mmd; ++j) {
                                  var ti = i2 - dif + j + 32768 & 32767;
                                  var pti = prev[ti];
                                  var cd = ti - pti + 32768 & 32767;
                                  if (cd > md)
                                    md = cd, pimod = ti;
                                }
                              }
                            }
                            imod = pimod, pimod = prev[imod];
                            dif += imod - pimod + 32768 & 32767;
                          }
                        }
                        if (d) {
                          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
                          var lin = revfl[l] & 31, din = revfd[d] & 31;
                          eb += fleb[lin] + fdeb[din];
                          ++lf[257 + lin];
                          ++df[din];
                          wi = i2 + l;
                          ++lc_1;
                        } else {
                          syms[li++] = dat[i2];
                          ++lf[dat[i2]];
                        }
                      }
                    }
                    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
                    if (!lst && pos & 7)
                      pos = wfblk(w, pos + 1, et);
                  }
                  return slc(o, 0, pre + shft(pos) + post);
                };
                var crct = /* @__PURE__ */ (function() {
                  var t = new Int32Array(256);
                  for (var i2 = 0; i2 < 256; ++i2) {
                    var c = i2, k = 9;
                    while (--k)
                      c = (c & 1 && -306674912) ^ c >>> 1;
                    t[i2] = c;
                  }
                  return t;
                })();
                var crc = function() {
                  var c = -1;
                  return {
                    p: function(d) {
                      var cr = c;
                      for (var i2 = 0; i2 < d.length; ++i2)
                        cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
                      c = cr;
                    },
                    d: function() {
                      return ~c;
                    }
                  };
                };
                var adler = function() {
                  var a = 1, b = 0;
                  return {
                    p: function(d) {
                      var n = a, m = b;
                      var l = d.length | 0;
                      for (var i2 = 0; i2 != l; ) {
                        var e = Math.min(i2 + 2655, l);
                        for (; i2 < e; ++i2)
                          m += n += d[i2];
                        n = (n & 65535) + 15 * (n >> 16), m = (m & 65535) + 15 * (m >> 16);
                      }
                      a = n, b = m;
                    },
                    d: function() {
                      a %= 65521, b %= 65521;
                      return (a & 255) << 24 | a >>> 8 << 16 | (b & 255) << 8 | b >>> 8;
                    }
                  };
                };
                ;
                var dopt = function(dat, opt, pre, post, st) {
                  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 12 + opt.mem, pre, post, !st);
                };
                var mrg = function(a, b) {
                  var o = {};
                  for (var k in a)
                    o[k] = a[k];
                  for (var k in b)
                    o[k] = b[k];
                  return o;
                };
                var wcln = function(fn, fnStr, td2) {
                  var dt = fn();
                  var st = fn.toString();
                  var ks = st.slice(st.indexOf("[") + 1, st.lastIndexOf("]")).replace(/ /g, "").split(",");
                  for (var i2 = 0; i2 < dt.length; ++i2) {
                    var v = dt[i2], k = ks[i2];
                    if (typeof v == "function") {
                      fnStr += ";" + k + "=";
                      var st_1 = v.toString();
                      if (v.prototype) {
                        if (st_1.indexOf("[native code]") != -1) {
                          var spInd = st_1.indexOf(" ", 8) + 1;
                          fnStr += st_1.slice(spInd, st_1.indexOf("(", spInd));
                        } else {
                          fnStr += st_1;
                          for (var t in v.prototype)
                            fnStr += ";" + k + ".prototype." + t + "=" + v.prototype[t].toString();
                        }
                      } else
                        fnStr += st_1;
                    } else
                      td2[k] = v;
                  }
                  return [fnStr, td2];
                };
                var ch = [];
                var cbfs = function(v) {
                  var tl = [];
                  for (var k in v) {
                    if (v[k] instanceof u82 || v[k] instanceof u16 || v[k] instanceof u322)
                      tl.push((v[k] = new v[k].constructor(v[k])).buffer);
                  }
                  return tl;
                };
                var wrkr = function(fns, init, id, cb) {
                  var _a2;
                  if (!ch[id]) {
                    var fnStr = "", td_1 = {}, m = fns.length - 1;
                    for (var i2 = 0; i2 < m; ++i2)
                      _a2 = wcln(fns[i2], fnStr, td_1), fnStr = _a2[0], td_1 = _a2[1];
                    ch[id] = wcln(fns[m], fnStr, td_1);
                  }
                  var td2 = mrg({}, ch[id][1]);
                  return node_worker_1["default"](ch[id][0] + ";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage=" + init.toString() + "}", id, td2, cbfs(td2), cb);
                };
                var bInflt = function() {
                  return [u82, u16, u322, fleb, fdeb, clim, fl, fd, flrm, fdrm, rev, ec, hMap, max, bits, bits16, shft, slc, err, inflt, inflateSync, pbf, gu8];
                };
                var bDflt = function() {
                  return [u82, u16, u322, fleb, fdeb, clim, revfl, revfd, flm, flt, fdm, fdt, rev, deo, et, hMap, wbits, wbits16, hTree, ln, lc, clen, wfblk, wblk, shft, slc, dflt, dopt, deflateSync, pbf];
                };
                var gze = function() {
                  return [gzh, gzhl, wbytes, crc, crct];
                };
                var guze = function() {
                  return [gzs, gzl];
                };
                var zle = function() {
                  return [zlh, wbytes, adler];
                };
                var zule = function() {
                  return [zlv];
                };
                var pbf = function(msg) {
                  return postMessage(msg, [msg.buffer]);
                };
                var gu8 = function(o) {
                  return o && o.size && new u82(o.size);
                };
                var cbify = function(dat, opts, fns, init, id, cb) {
                  var w = wrkr(fns, init, id, function(err2, dat2) {
                    w.terminate();
                    cb(err2, dat2);
                  });
                  w.postMessage([dat, opts], opts.consume ? [dat.buffer] : []);
                  return function() {
                    w.terminate();
                  };
                };
                var astrm = function(strm) {
                  strm.ondata = function(dat, final) {
                    return postMessage([dat, final], [dat.buffer]);
                  };
                  return function(ev) {
                    return strm.push(ev.data[0], ev.data[1]);
                  };
                };
                var astrmify = function(fns, strm, opts, init, id) {
                  var t;
                  var w = wrkr(fns, init, id, function(err2, dat) {
                    if (err2)
                      w.terminate(), strm.ondata.call(strm, err2);
                    else {
                      if (dat[1])
                        w.terminate();
                      strm.ondata.call(strm, err2, dat[0], dat[1]);
                    }
                  });
                  w.postMessage(opts);
                  strm.push = function(d, f) {
                    if (!strm.ondata)
                      err(5);
                    if (t)
                      strm.ondata(err(4, 0, 1), null, !!f);
                    w.postMessage([d, t = f], [d.buffer]);
                  };
                  strm.terminate = function() {
                    w.terminate();
                  };
                };
                var b2 = function(d, b) {
                  return d[b] | d[b + 1] << 8;
                };
                var b4 = function(d, b) {
                  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
                };
                var b8 = function(d, b) {
                  return b4(d, b) + b4(d, b + 4) * 4294967296;
                };
                var wbytes = function(d, b, v) {
                  for (; v; ++b)
                    d[b] = v, v >>>= 8;
                };
                var gzh = function(c, o) {
                  var fn = o.filename;
                  c[0] = 31, c[1] = 139, c[2] = 8, c[8] = o.level < 2 ? 4 : o.level == 9 ? 2 : 0, c[9] = 3;
                  if (o.mtime != 0)
                    wbytes(c, 4, Math.floor(new Date(o.mtime || Date.now()) / 1e3));
                  if (fn) {
                    c[3] = 8;
                    for (var i2 = 0; i2 <= fn.length; ++i2)
                      c[i2 + 10] = fn.charCodeAt(i2);
                  }
                };
                var gzs = function(d) {
                  if (d[0] != 31 || d[1] != 139 || d[2] != 8)
                    err(6, "invalid gzip data");
                  var flg = d[3];
                  var st = 10;
                  if (flg & 4)
                    st += d[10] | (d[11] << 8) + 2;
                  for (var zs = (flg >> 3 & 1) + (flg >> 4 & 1); zs > 0; zs -= !d[st++])
                    ;
                  return st + (flg & 2);
                };
                var gzl = function(d) {
                  var l = d.length;
                  return (d[l - 4] | d[l - 3] << 8 | d[l - 2] << 16 | d[l - 1] << 24) >>> 0;
                };
                var gzhl = function(o) {
                  return 10 + (o.filename && o.filename.length + 1 || 0);
                };
                var zlh = function(c, o) {
                  var lv = o.level, fl2 = lv == 0 ? 0 : lv < 6 ? 1 : lv == 9 ? 3 : 2;
                  c[0] = 120, c[1] = fl2 << 6 | (fl2 ? 32 - 2 * fl2 : 1);
                };
                var zlv = function(d) {
                  if ((d[0] & 15) != 8 || d[0] >>> 4 > 7 || (d[0] << 8 | d[1]) % 31)
                    err(6, "invalid zlib data");
                  if (d[1] & 32)
                    err(6, "invalid zlib data: preset dictionaries not supported");
                };
                function AsyncCmpStrm(opts, cb) {
                  if (!cb && typeof opts == "function")
                    cb = opts, opts = {};
                  this.ondata = cb;
                  return opts;
                }
                var Deflate = /* @__PURE__ */ (function() {
                  function Deflate2(opts, cb) {
                    if (!cb && typeof opts == "function")
                      cb = opts, opts = {};
                    this.ondata = cb;
                    this.o = opts || {};
                  }
                  Deflate2.prototype.p = function(c, f) {
                    this.ondata(dopt(c, this.o, 0, 0, !f), f);
                  };
                  Deflate2.prototype.push = function(chunk, final) {
                    if (!this.ondata)
                      err(5);
                    if (this.d)
                      err(4);
                    this.d = final;
                    this.p(chunk, final || false);
                  };
                  return Deflate2;
                })();
                exports2.Deflate = Deflate;
                var AsyncDeflate = /* @__PURE__ */ (function() {
                  function AsyncDeflate2(opts, cb) {
                    astrmify([
                      bDflt,
                      function() {
                        return [astrm, Deflate];
                      }
                    ], this, AsyncCmpStrm.call(this, opts, cb), function(ev) {
                      var strm = new Deflate(ev.data);
                      onmessage = astrm(strm);
                    }, 6);
                  }
                  return AsyncDeflate2;
                })();
                exports2.AsyncDeflate = AsyncDeflate;
                function deflate(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return cbify(data, opts, [
                    bDflt
                  ], function(ev) {
                    return pbf(deflateSync(ev.data[0], ev.data[1]));
                  }, 0, cb);
                }
                exports2.deflate = deflate;
                function deflateSync(data, opts) {
                  return dopt(data, opts || {}, 0, 0);
                }
                exports2.deflateSync = deflateSync;
                var Inflate = /* @__PURE__ */ (function() {
                  function Inflate2(cb) {
                    this.s = {};
                    this.p = new u82(0);
                    this.ondata = cb;
                  }
                  Inflate2.prototype.e = function(c) {
                    if (!this.ondata)
                      err(5);
                    if (this.d)
                      err(4);
                    var l = this.p.length;
                    var n = new u82(l + c.length);
                    n.set(this.p), n.set(c, l), this.p = n;
                  };
                  Inflate2.prototype.c = function(final) {
                    this.d = this.s.i = final || false;
                    var bts = this.s.b;
                    var dt = inflt(this.p, this.o, this.s);
                    this.ondata(slc(dt, bts, this.s.b), this.d);
                    this.o = slc(dt, this.s.b - 32768), this.s.b = this.o.length;
                    this.p = slc(this.p, this.s.p / 8 | 0), this.s.p &= 7;
                  };
                  Inflate2.prototype.push = function(chunk, final) {
                    this.e(chunk), this.c(final);
                  };
                  return Inflate2;
                })();
                exports2.Inflate = Inflate;
                var AsyncInflate = /* @__PURE__ */ (function() {
                  function AsyncInflate2(cb) {
                    this.ondata = cb;
                    astrmify([
                      bInflt,
                      function() {
                        return [astrm, Inflate];
                      }
                    ], this, 0, function() {
                      var strm = new Inflate();
                      onmessage = astrm(strm);
                    }, 7);
                  }
                  return AsyncInflate2;
                })();
                exports2.AsyncInflate = AsyncInflate;
                function inflate(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return cbify(data, opts, [
                    bInflt
                  ], function(ev) {
                    return pbf(inflateSync(ev.data[0], gu8(ev.data[1])));
                  }, 1, cb);
                }
                exports2.inflate = inflate;
                function inflateSync(data, out) {
                  return inflt(data, out);
                }
                exports2.inflateSync = inflateSync;
                var Gzip = /* @__PURE__ */ (function() {
                  function Gzip2(opts, cb) {
                    this.c = crc();
                    this.l = 0;
                    this.v = 1;
                    Deflate.call(this, opts, cb);
                  }
                  Gzip2.prototype.push = function(chunk, final) {
                    Deflate.prototype.push.call(this, chunk, final);
                  };
                  Gzip2.prototype.p = function(c, f) {
                    this.c.p(c);
                    this.l += c.length;
                    var raw = dopt(c, this.o, this.v && gzhl(this.o), f && 8, !f);
                    if (this.v)
                      gzh(raw, this.o), this.v = 0;
                    if (f)
                      wbytes(raw, raw.length - 8, this.c.d()), wbytes(raw, raw.length - 4, this.l);
                    this.ondata(raw, f);
                  };
                  return Gzip2;
                })();
                exports2.Gzip = Gzip;
                exports2.Compress = Gzip;
                var AsyncGzip = /* @__PURE__ */ (function() {
                  function AsyncGzip2(opts, cb) {
                    astrmify([
                      bDflt,
                      gze,
                      function() {
                        return [astrm, Deflate, Gzip];
                      }
                    ], this, AsyncCmpStrm.call(this, opts, cb), function(ev) {
                      var strm = new Gzip(ev.data);
                      onmessage = astrm(strm);
                    }, 8);
                  }
                  return AsyncGzip2;
                })();
                exports2.AsyncGzip = AsyncGzip;
                exports2.AsyncCompress = AsyncGzip;
                function gzip(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return cbify(data, opts, [
                    bDflt,
                    gze,
                    function() {
                      return [gzipSync];
                    }
                  ], function(ev) {
                    return pbf(gzipSync(ev.data[0], ev.data[1]));
                  }, 2, cb);
                }
                exports2.gzip = gzip;
                exports2.compress = gzip;
                function gzipSync(data, opts) {
                  if (!opts)
                    opts = {};
                  var c = crc(), l = data.length;
                  c.p(data);
                  var d = dopt(data, opts, gzhl(opts), 8), s = d.length;
                  return gzh(d, opts), wbytes(d, s - 8, c.d()), wbytes(d, s - 4, l), d;
                }
                exports2.gzipSync = gzipSync;
                exports2.compressSync = gzipSync;
                var Gunzip = /* @__PURE__ */ (function() {
                  function Gunzip2(cb) {
                    this.v = 1;
                    Inflate.call(this, cb);
                  }
                  Gunzip2.prototype.push = function(chunk, final) {
                    Inflate.prototype.e.call(this, chunk);
                    if (this.v) {
                      var s = this.p.length > 3 ? gzs(this.p) : 4;
                      if (s >= this.p.length && !final)
                        return;
                      this.p = this.p.subarray(s), this.v = 0;
                    }
                    if (final) {
                      if (this.p.length < 8)
                        err(6, "invalid gzip data");
                      this.p = this.p.subarray(0, -8);
                    }
                    Inflate.prototype.c.call(this, final);
                  };
                  return Gunzip2;
                })();
                exports2.Gunzip = Gunzip;
                var AsyncGunzip = /* @__PURE__ */ (function() {
                  function AsyncGunzip2(cb) {
                    this.ondata = cb;
                    astrmify([
                      bInflt,
                      guze,
                      function() {
                        return [astrm, Inflate, Gunzip];
                      }
                    ], this, 0, function() {
                      var strm = new Gunzip();
                      onmessage = astrm(strm);
                    }, 9);
                  }
                  return AsyncGunzip2;
                })();
                exports2.AsyncGunzip = AsyncGunzip;
                function gunzip(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return cbify(data, opts, [
                    bInflt,
                    guze,
                    function() {
                      return [gunzipSync];
                    }
                  ], function(ev) {
                    return pbf(gunzipSync(ev.data[0]));
                  }, 3, cb);
                }
                exports2.gunzip = gunzip;
                function gunzipSync(data, out) {
                  return inflt(data.subarray(gzs(data), -8), out || new u82(gzl(data)));
                }
                exports2.gunzipSync = gunzipSync;
                var Zlib = /* @__PURE__ */ (function() {
                  function Zlib2(opts, cb) {
                    this.c = adler();
                    this.v = 1;
                    Deflate.call(this, opts, cb);
                  }
                  Zlib2.prototype.push = function(chunk, final) {
                    Deflate.prototype.push.call(this, chunk, final);
                  };
                  Zlib2.prototype.p = function(c, f) {
                    this.c.p(c);
                    var raw = dopt(c, this.o, this.v && 2, f && 4, !f);
                    if (this.v)
                      zlh(raw, this.o), this.v = 0;
                    if (f)
                      wbytes(raw, raw.length - 4, this.c.d());
                    this.ondata(raw, f);
                  };
                  return Zlib2;
                })();
                exports2.Zlib = Zlib;
                var AsyncZlib = /* @__PURE__ */ (function() {
                  function AsyncZlib2(opts, cb) {
                    astrmify([
                      bDflt,
                      zle,
                      function() {
                        return [astrm, Deflate, Zlib];
                      }
                    ], this, AsyncCmpStrm.call(this, opts, cb), function(ev) {
                      var strm = new Zlib(ev.data);
                      onmessage = astrm(strm);
                    }, 10);
                  }
                  return AsyncZlib2;
                })();
                exports2.AsyncZlib = AsyncZlib;
                function zlib(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return cbify(data, opts, [
                    bDflt,
                    zle,
                    function() {
                      return [zlibSync];
                    }
                  ], function(ev) {
                    return pbf(zlibSync(ev.data[0], ev.data[1]));
                  }, 4, cb);
                }
                exports2.zlib = zlib;
                function zlibSync(data, opts) {
                  if (!opts)
                    opts = {};
                  var a = adler();
                  a.p(data);
                  var d = dopt(data, opts, 2, 4);
                  return zlh(d, opts), wbytes(d, d.length - 4, a.d()), d;
                }
                exports2.zlibSync = zlibSync;
                var Unzlib = /* @__PURE__ */ (function() {
                  function Unzlib2(cb) {
                    this.v = 1;
                    Inflate.call(this, cb);
                  }
                  Unzlib2.prototype.push = function(chunk, final) {
                    Inflate.prototype.e.call(this, chunk);
                    if (this.v) {
                      if (this.p.length < 2 && !final)
                        return;
                      this.p = this.p.subarray(2), this.v = 0;
                    }
                    if (final) {
                      if (this.p.length < 4)
                        err(6, "invalid zlib data");
                      this.p = this.p.subarray(0, -4);
                    }
                    Inflate.prototype.c.call(this, final);
                  };
                  return Unzlib2;
                })();
                exports2.Unzlib = Unzlib;
                var AsyncUnzlib = /* @__PURE__ */ (function() {
                  function AsyncUnzlib2(cb) {
                    this.ondata = cb;
                    astrmify([
                      bInflt,
                      zule,
                      function() {
                        return [astrm, Inflate, Unzlib];
                      }
                    ], this, 0, function() {
                      var strm = new Unzlib();
                      onmessage = astrm(strm);
                    }, 11);
                  }
                  return AsyncUnzlib2;
                })();
                exports2.AsyncUnzlib = AsyncUnzlib;
                function unzlib(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return cbify(data, opts, [
                    bInflt,
                    zule,
                    function() {
                      return [unzlibSync];
                    }
                  ], function(ev) {
                    return pbf(unzlibSync(ev.data[0], gu8(ev.data[1])));
                  }, 5, cb);
                }
                exports2.unzlib = unzlib;
                function unzlibSync(data, out) {
                  return inflt((zlv(data), data.subarray(2, -4)), out);
                }
                exports2.unzlibSync = unzlibSync;
                var Decompress = /* @__PURE__ */ (function() {
                  function Decompress2(cb) {
                    this.G = Gunzip;
                    this.I = Inflate;
                    this.Z = Unzlib;
                    this.ondata = cb;
                  }
                  Decompress2.prototype.push = function(chunk, final) {
                    if (!this.ondata)
                      err(5);
                    if (!this.s) {
                      if (this.p && this.p.length) {
                        var n = new u82(this.p.length + chunk.length);
                        n.set(this.p), n.set(chunk, this.p.length);
                      } else
                        this.p = chunk;
                      if (this.p.length > 2) {
                        var _this_1 = this;
                        var cb = function() {
                          _this_1.ondata.apply(_this_1, arguments);
                        };
                        this.s = this.p[0] == 31 && this.p[1] == 139 && this.p[2] == 8 ? new this.G(cb) : (this.p[0] & 15) != 8 || this.p[0] >> 4 > 7 || (this.p[0] << 8 | this.p[1]) % 31 ? new this.I(cb) : new this.Z(cb);
                        this.s.push(this.p, final);
                        this.p = null;
                      }
                    } else
                      this.s.push(chunk, final);
                  };
                  return Decompress2;
                })();
                exports2.Decompress = Decompress;
                var AsyncDecompress = /* @__PURE__ */ (function() {
                  function AsyncDecompress2(cb) {
                    this.G = AsyncGunzip;
                    this.I = AsyncInflate;
                    this.Z = AsyncUnzlib;
                    this.ondata = cb;
                  }
                  AsyncDecompress2.prototype.push = function(chunk, final) {
                    Decompress.prototype.push.call(this, chunk, final);
                  };
                  return AsyncDecompress2;
                })();
                exports2.AsyncDecompress = AsyncDecompress;
                function decompress(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  return data[0] == 31 && data[1] == 139 && data[2] == 8 ? gunzip(data, opts, cb) : (data[0] & 15) != 8 || data[0] >> 4 > 7 || (data[0] << 8 | data[1]) % 31 ? inflate(data, opts, cb) : unzlib(data, opts, cb);
                }
                exports2.decompress = decompress;
                function decompressSync(data, out) {
                  return data[0] == 31 && data[1] == 139 && data[2] == 8 ? gunzipSync(data, out) : (data[0] & 15) != 8 || data[0] >> 4 > 7 || (data[0] << 8 | data[1]) % 31 ? inflateSync(data, out) : unzlibSync(data, out);
                }
                exports2.decompressSync = decompressSync;
                var fltn = function(d, p, t, o) {
                  for (var k in d) {
                    var val = d[k], n = p + k;
                    if (val instanceof u82)
                      t[n] = [val, o];
                    else if (Array.isArray(val))
                      t[n] = [val[0], mrg(o, val[1])];
                    else
                      fltn(val, n + "/", t, o);
                  }
                };
                var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
                var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
                var tds = 0;
                try {
                  td.decode(et, { stream: true });
                  tds = 1;
                } catch (e) {
                }
                var dutf8 = function(d) {
                  for (var r = "", i2 = 0; ; ) {
                    var c = d[i2++];
                    var eb = (c > 127) + (c > 223) + (c > 239);
                    if (i2 + eb > d.length)
                      return [r, slc(d, i2 - 1)];
                    if (!eb)
                      r += String.fromCharCode(c);
                    else if (eb == 3) {
                      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
                    } else if (eb & 1)
                      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
                    else
                      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
                  }
                };
                var DecodeUTF8 = /* @__PURE__ */ (function() {
                  function DecodeUTF82(cb) {
                    this.ondata = cb;
                    if (tds)
                      this.t = new TextDecoder();
                    else
                      this.p = et;
                  }
                  DecodeUTF82.prototype.push = function(chunk, final) {
                    if (!this.ondata)
                      err(5);
                    final = !!final;
                    if (this.t) {
                      this.ondata(this.t.decode(chunk, { stream: true }), final);
                      if (final) {
                        if (this.t.decode().length)
                          err(8);
                        this.t = null;
                      }
                      return;
                    }
                    if (!this.p)
                      err(4);
                    var dat = new u82(this.p.length + chunk.length);
                    dat.set(this.p);
                    dat.set(chunk, this.p.length);
                    var _a2 = dutf8(dat), ch2 = _a2[0], np = _a2[1];
                    if (final) {
                      if (np.length)
                        err(8);
                      this.p = null;
                    } else
                      this.p = np;
                    this.ondata(ch2, final);
                  };
                  return DecodeUTF82;
                })();
                exports2.DecodeUTF8 = DecodeUTF8;
                var EncodeUTF8 = /* @__PURE__ */ (function() {
                  function EncodeUTF82(cb) {
                    this.ondata = cb;
                  }
                  EncodeUTF82.prototype.push = function(chunk, final) {
                    if (!this.ondata)
                      err(5);
                    if (this.d)
                      err(4);
                    this.ondata(strToU8(chunk), this.d = final || false);
                  };
                  return EncodeUTF82;
                })();
                exports2.EncodeUTF8 = EncodeUTF8;
                function strToU8(str, latin1) {
                  if (latin1) {
                    var ar_1 = new u82(str.length);
                    for (var i2 = 0; i2 < str.length; ++i2)
                      ar_1[i2] = str.charCodeAt(i2);
                    return ar_1;
                  }
                  if (te)
                    return te.encode(str);
                  var l = str.length;
                  var ar = new u82(str.length + (str.length >> 1));
                  var ai = 0;
                  var w = function(v) {
                    ar[ai++] = v;
                  };
                  for (var i2 = 0; i2 < l; ++i2) {
                    if (ai + 5 > ar.length) {
                      var n = new u82(ai + 8 + (l - i2 << 1));
                      n.set(ar);
                      ar = n;
                    }
                    var c = str.charCodeAt(i2);
                    if (c < 128 || latin1)
                      w(c);
                    else if (c < 2048)
                      w(192 | c >> 6), w(128 | c & 63);
                    else if (c > 55295 && c < 57344)
                      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i2) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
                    else
                      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
                  }
                  return slc(ar, 0, ai);
                }
                exports2.strToU8 = strToU8;
                function strFromU8(dat, latin1) {
                  if (latin1) {
                    var r = "";
                    for (var i2 = 0; i2 < dat.length; i2 += 16384)
                      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
                    return r;
                  } else if (td)
                    return td.decode(dat);
                  else {
                    var _a2 = dutf8(dat), out = _a2[0], ext = _a2[1];
                    if (ext.length)
                      err(8);
                    return out;
                  }
                }
                exports2.strFromU8 = strFromU8;
                ;
                var dbf = function(l) {
                  return l == 1 ? 3 : l < 6 ? 2 : l == 9 ? 1 : 0;
                };
                var slzh = function(d, b) {
                  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
                };
                var zh = function(d, b, z) {
                  var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
                  var _a2 = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
                  return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
                };
                var z64e = function(d, b) {
                  for (; b2(d, b) != 1; b += 4 + b2(d, b + 2))
                    ;
                  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
                };
                var exfl = function(ex) {
                  var le = 0;
                  if (ex) {
                    for (var k in ex) {
                      var l = ex[k].length;
                      if (l > 65535)
                        err(9);
                      le += l + 4;
                    }
                  }
                  return le;
                };
                var wzh = function(d, b, f, fn, u, c, ce, co) {
                  var fl2 = fn.length, ex = f.extra, col = co && co.length;
                  var exl = exfl(ex);
                  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
                  if (ce != null)
                    d[b++] = 20, d[b++] = f.os;
                  d[b] = 20, b += 2;
                  d[b++] = f.flag << 1 | (c == null && 8), d[b++] = u && 8;
                  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
                  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
                  if (y < 0 || y > 119)
                    err(10);
                  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >>> 1), b += 4;
                  if (c != null) {
                    wbytes(d, b, f.crc);
                    wbytes(d, b + 4, c);
                    wbytes(d, b + 8, f.size);
                  }
                  wbytes(d, b + 12, fl2);
                  wbytes(d, b + 14, exl), b += 16;
                  if (ce != null) {
                    wbytes(d, b, col);
                    wbytes(d, b + 6, f.attrs);
                    wbytes(d, b + 10, ce), b += 14;
                  }
                  d.set(fn, b);
                  b += fl2;
                  if (exl) {
                    for (var k in ex) {
                      var exf = ex[k], l = exf.length;
                      wbytes(d, b, +k);
                      wbytes(d, b + 2, l);
                      d.set(exf, b + 4), b += 4 + l;
                    }
                  }
                  if (col)
                    d.set(co, b), b += col;
                  return b;
                };
                var wzf = function(o, b, c, d, e) {
                  wbytes(o, b, 101010256);
                  wbytes(o, b + 8, c);
                  wbytes(o, b + 10, c);
                  wbytes(o, b + 12, d);
                  wbytes(o, b + 16, e);
                };
                var ZipPassThrough = /* @__PURE__ */ (function() {
                  function ZipPassThrough2(filename) {
                    this.filename = filename;
                    this.c = crc();
                    this.size = 0;
                    this.compression = 0;
                  }
                  ZipPassThrough2.prototype.process = function(chunk, final) {
                    this.ondata(null, chunk, final);
                  };
                  ZipPassThrough2.prototype.push = function(chunk, final) {
                    if (!this.ondata)
                      err(5);
                    this.c.p(chunk);
                    this.size += chunk.length;
                    if (final)
                      this.crc = this.c.d();
                    this.process(chunk, final || false);
                  };
                  return ZipPassThrough2;
                })();
                exports2.ZipPassThrough = ZipPassThrough;
                var ZipDeflate = /* @__PURE__ */ (function() {
                  function ZipDeflate2(filename, opts) {
                    var _this_1 = this;
                    if (!opts)
                      opts = {};
                    ZipPassThrough.call(this, filename);
                    this.d = new Deflate(opts, function(dat, final) {
                      _this_1.ondata(null, dat, final);
                    });
                    this.compression = 8;
                    this.flag = dbf(opts.level);
                  }
                  ZipDeflate2.prototype.process = function(chunk, final) {
                    try {
                      this.d.push(chunk, final);
                    } catch (e) {
                      this.ondata(e, null, final);
                    }
                  };
                  ZipDeflate2.prototype.push = function(chunk, final) {
                    ZipPassThrough.prototype.push.call(this, chunk, final);
                  };
                  return ZipDeflate2;
                })();
                exports2.ZipDeflate = ZipDeflate;
                var AsyncZipDeflate = /* @__PURE__ */ (function() {
                  function AsyncZipDeflate2(filename, opts) {
                    var _this_1 = this;
                    if (!opts)
                      opts = {};
                    ZipPassThrough.call(this, filename);
                    this.d = new AsyncDeflate(opts, function(err2, dat, final) {
                      _this_1.ondata(err2, dat, final);
                    });
                    this.compression = 8;
                    this.flag = dbf(opts.level);
                    this.terminate = this.d.terminate;
                  }
                  AsyncZipDeflate2.prototype.process = function(chunk, final) {
                    this.d.push(chunk, final);
                  };
                  AsyncZipDeflate2.prototype.push = function(chunk, final) {
                    ZipPassThrough.prototype.push.call(this, chunk, final);
                  };
                  return AsyncZipDeflate2;
                })();
                exports2.AsyncZipDeflate = AsyncZipDeflate;
                var Zip = /* @__PURE__ */ (function() {
                  function Zip2(cb) {
                    this.ondata = cb;
                    this.u = [];
                    this.d = 1;
                  }
                  Zip2.prototype.add = function(file) {
                    var _this_1 = this;
                    if (!this.ondata)
                      err(5);
                    if (this.d & 2)
                      this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, false);
                    else {
                      var f = strToU8(file.filename), fl_1 = f.length;
                      var com = file.comment, o = com && strToU8(com);
                      var u = fl_1 != file.filename.length || o && com.length != o.length;
                      var hl_1 = fl_1 + exfl(file.extra) + 30;
                      if (fl_1 > 65535)
                        this.ondata(err(11, 0, 1), null, false);
                      var header = new u82(hl_1);
                      wzh(header, 0, file, f, u);
                      var chks_1 = [header];
                      var pAll_1 = function() {
                        for (var _i = 0, chks_2 = chks_1; _i < chks_2.length; _i++) {
                          var chk = chks_2[_i];
                          _this_1.ondata(null, chk, false);
                        }
                        chks_1 = [];
                      };
                      var tr_1 = this.d;
                      this.d = 0;
                      var ind_1 = this.u.length;
                      var uf_1 = mrg(file, {
                        f,
                        u,
                        o,
                        t: function() {
                          if (file.terminate)
                            file.terminate();
                        },
                        r: function() {
                          pAll_1();
                          if (tr_1) {
                            var nxt = _this_1.u[ind_1 + 1];
                            if (nxt)
                              nxt.r();
                            else
                              _this_1.d = 1;
                          }
                          tr_1 = 1;
                        }
                      });
                      var cl_1 = 0;
                      file.ondata = function(err2, dat, final) {
                        if (err2) {
                          _this_1.ondata(err2, dat, final);
                          _this_1.terminate();
                        } else {
                          cl_1 += dat.length;
                          chks_1.push(dat);
                          if (final) {
                            var dd = new u82(16);
                            wbytes(dd, 0, 134695760);
                            wbytes(dd, 4, file.crc);
                            wbytes(dd, 8, cl_1);
                            wbytes(dd, 12, file.size);
                            chks_1.push(dd);
                            uf_1.c = cl_1, uf_1.b = hl_1 + cl_1 + 16, uf_1.crc = file.crc, uf_1.size = file.size;
                            if (tr_1)
                              uf_1.r();
                            tr_1 = 1;
                          } else if (tr_1)
                            pAll_1();
                        }
                      };
                      this.u.push(uf_1);
                    }
                  };
                  Zip2.prototype.end = function() {
                    var _this_1 = this;
                    if (this.d & 2) {
                      this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, true);
                      return;
                    }
                    if (this.d)
                      this.e();
                    else
                      this.u.push({
                        r: function() {
                          if (!(_this_1.d & 1))
                            return;
                          _this_1.u.splice(-1, 1);
                          _this_1.e();
                        },
                        t: function() {
                        }
                      });
                    this.d = 3;
                  };
                  Zip2.prototype.e = function() {
                    var bt = 0, l = 0, tl = 0;
                    for (var _i = 0, _a2 = this.u; _i < _a2.length; _i++) {
                      var f = _a2[_i];
                      tl += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0);
                    }
                    var out = new u82(tl + 22);
                    for (var _b2 = 0, _c = this.u; _b2 < _c.length; _b2++) {
                      var f = _c[_b2];
                      wzh(out, bt, f, f.f, f.u, f.c, l, f.o);
                      bt += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0), l += f.b;
                    }
                    wzf(out, bt, this.u.length, tl, l);
                    this.ondata(null, out, true);
                    this.d = 2;
                  };
                  Zip2.prototype.terminate = function() {
                    for (var _i = 0, _a2 = this.u; _i < _a2.length; _i++) {
                      var f = _a2[_i];
                      f.t();
                    }
                    this.d = 2;
                  };
                  return Zip2;
                })();
                exports2.Zip = Zip;
                function zip(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  var r = {};
                  fltn(data, "", r, opts);
                  var k = Object.keys(r);
                  var lft = k.length, o = 0, tot = 0;
                  var slft = lft, files = new Array(lft);
                  var term = [];
                  var tAll = function() {
                    for (var i3 = 0; i3 < term.length; ++i3)
                      term[i3]();
                  };
                  var cbd = function(a, b) {
                    mt(function() {
                      cb(a, b);
                    });
                  };
                  mt(function() {
                    cbd = cb;
                  });
                  var cbf = function() {
                    var out = new u82(tot + 22), oe = o, cdl = tot - o;
                    tot = 0;
                    for (var i3 = 0; i3 < slft; ++i3) {
                      var f = files[i3];
                      try {
                        var l = f.c.length;
                        wzh(out, tot, f, f.f, f.u, l);
                        var badd = 30 + f.f.length + exfl(f.extra);
                        var loc = tot + badd;
                        out.set(f.c, loc);
                        wzh(out, o, f, f.f, f.u, l, tot, f.m), o += 16 + badd + (f.m ? f.m.length : 0), tot = loc + l;
                      } catch (e) {
                        return cbd(e, null);
                      }
                    }
                    wzf(out, o, files.length, cdl, oe);
                    cbd(null, out);
                  };
                  if (!lft)
                    cbf();
                  var _loop_1 = function(i3) {
                    var fn = k[i3];
                    var _a2 = r[fn], file = _a2[0], p = _a2[1];
                    var c = crc(), size = file.length;
                    c.p(file);
                    var f = strToU8(fn), s = f.length;
                    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
                    var exl = exfl(p.extra);
                    var compression = p.level == 0 ? 0 : 8;
                    var cbl = function(e, d) {
                      if (e) {
                        tAll();
                        cbd(e, null);
                      } else {
                        var l = d.length;
                        files[i3] = mrg(p, {
                          size,
                          crc: c.d(),
                          c: d,
                          f,
                          m,
                          u: s != fn.length || m && com.length != ms,
                          compression
                        });
                        o += 30 + s + exl + l;
                        tot += 76 + 2 * (s + exl) + (ms || 0) + l;
                        if (!--lft)
                          cbf();
                      }
                    };
                    if (s > 65535)
                      cbl(err(11, 0, 1), null);
                    if (!compression)
                      cbl(null, file);
                    else if (size < 16e4) {
                      try {
                        cbl(null, deflateSync(file, p));
                      } catch (e) {
                        cbl(e, null);
                      }
                    } else
                      term.push(deflate(file, p, cbl));
                  };
                  for (var i2 = 0; i2 < slft; ++i2) {
                    _loop_1(i2);
                  }
                  return tAll;
                }
                exports2.zip = zip;
                function zipSync(data, opts) {
                  if (!opts)
                    opts = {};
                  var r = {};
                  var files = [];
                  fltn(data, "", r, opts);
                  var o = 0;
                  var tot = 0;
                  for (var fn in r) {
                    var _a2 = r[fn], file = _a2[0], p = _a2[1];
                    var compression = p.level == 0 ? 0 : 8;
                    var f = strToU8(fn), s = f.length;
                    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
                    var exl = exfl(p.extra);
                    if (s > 65535)
                      err(11);
                    var d = compression ? deflateSync(file, p) : file, l = d.length;
                    var c = crc();
                    c.p(file);
                    files.push(mrg(p, {
                      size: file.length,
                      crc: c.d(),
                      c: d,
                      f,
                      m,
                      u: s != fn.length || m && com.length != ms,
                      o,
                      compression
                    }));
                    o += 30 + s + exl + l;
                    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
                  }
                  var out = new u82(tot + 22), oe = o, cdl = tot - o;
                  for (var i2 = 0; i2 < files.length; ++i2) {
                    var f = files[i2];
                    wzh(out, f.o, f, f.f, f.u, f.c.length);
                    var badd = 30 + f.f.length + exfl(f.extra);
                    out.set(f.c, f.o + badd);
                    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
                  }
                  wzf(out, o, files.length, cdl, oe);
                  return out;
                }
                exports2.zipSync = zipSync;
                var UnzipPassThrough = /* @__PURE__ */ (function() {
                  function UnzipPassThrough2() {
                  }
                  UnzipPassThrough2.prototype.push = function(data, final) {
                    this.ondata(null, data, final);
                  };
                  UnzipPassThrough2.compression = 0;
                  return UnzipPassThrough2;
                })();
                exports2.UnzipPassThrough = UnzipPassThrough;
                var UnzipInflate = /* @__PURE__ */ (function() {
                  function UnzipInflate2() {
                    var _this_1 = this;
                    this.i = new Inflate(function(dat, final) {
                      _this_1.ondata(null, dat, final);
                    });
                  }
                  UnzipInflate2.prototype.push = function(data, final) {
                    try {
                      this.i.push(data, final);
                    } catch (e) {
                      this.ondata(e, null, final);
                    }
                  };
                  UnzipInflate2.compression = 8;
                  return UnzipInflate2;
                })();
                exports2.UnzipInflate = UnzipInflate;
                var AsyncUnzipInflate = /* @__PURE__ */ (function() {
                  function AsyncUnzipInflate2(_, sz) {
                    var _this_1 = this;
                    if (sz < 32e4) {
                      this.i = new Inflate(function(dat, final) {
                        _this_1.ondata(null, dat, final);
                      });
                    } else {
                      this.i = new AsyncInflate(function(err2, dat, final) {
                        _this_1.ondata(err2, dat, final);
                      });
                      this.terminate = this.i.terminate;
                    }
                  }
                  AsyncUnzipInflate2.prototype.push = function(data, final) {
                    if (this.i.terminate)
                      data = slc(data, 0);
                    this.i.push(data, final);
                  };
                  AsyncUnzipInflate2.compression = 8;
                  return AsyncUnzipInflate2;
                })();
                exports2.AsyncUnzipInflate = AsyncUnzipInflate;
                var Unzip = /* @__PURE__ */ (function() {
                  function Unzip2(cb) {
                    this.onfile = cb;
                    this.k = [];
                    this.o = {
                      0: UnzipPassThrough
                    };
                    this.p = et;
                  }
                  Unzip2.prototype.push = function(chunk, final) {
                    var _this_1 = this;
                    if (!this.onfile)
                      err(5);
                    if (!this.p)
                      err(4);
                    if (this.c > 0) {
                      var len = Math.min(this.c, chunk.length);
                      var toAdd = chunk.subarray(0, len);
                      this.c -= len;
                      if (this.d)
                        this.d.push(toAdd, !this.c);
                      else
                        this.k[0].push(toAdd);
                      chunk = chunk.subarray(len);
                      if (chunk.length)
                        return this.push(chunk, final);
                    } else {
                      var f = 0, i2 = 0, is = void 0, buf = void 0;
                      if (!this.p.length)
                        buf = chunk;
                      else if (!chunk.length)
                        buf = this.p;
                      else {
                        buf = new u82(this.p.length + chunk.length);
                        buf.set(this.p), buf.set(chunk, this.p.length);
                      }
                      var l = buf.length, oc = this.c, add2 = oc && this.d;
                      var _loop_2 = function() {
                        var _a2;
                        var sig = b4(buf, i2);
                        if (sig == 67324752) {
                          f = 1, is = i2;
                          this_1.d = null;
                          this_1.c = 0;
                          var bf = b2(buf, i2 + 6), cmp_1 = b2(buf, i2 + 8), u = bf & 2048, dd = bf & 8, fnl = b2(buf, i2 + 26), es = b2(buf, i2 + 28);
                          if (l > i2 + 30 + fnl + es) {
                            var chks_3 = [];
                            this_1.k.unshift(chks_3);
                            f = 2;
                            var sc_1 = b4(buf, i2 + 18), su_1 = b4(buf, i2 + 22);
                            var fn_1 = strFromU8(buf.subarray(i2 + 30, i2 += 30 + fnl), !u);
                            if (sc_1 == 4294967295) {
                              _a2 = dd ? [-2] : z64e(buf, i2), sc_1 = _a2[0], su_1 = _a2[1];
                            } else if (dd)
                              sc_1 = -1;
                            i2 += es;
                            this_1.c = sc_1;
                            var d_1;
                            var file_1 = {
                              name: fn_1,
                              compression: cmp_1,
                              start: function() {
                                if (!file_1.ondata)
                                  err(5);
                                if (!sc_1)
                                  file_1.ondata(null, et, true);
                                else {
                                  var ctr = _this_1.o[cmp_1];
                                  if (!ctr)
                                    file_1.ondata(err(14, "unknown compression type " + cmp_1, 1), null, false);
                                  d_1 = sc_1 < 0 ? new ctr(fn_1) : new ctr(fn_1, sc_1, su_1);
                                  d_1.ondata = function(err2, dat3, final2) {
                                    file_1.ondata(err2, dat3, final2);
                                  };
                                  for (var _i = 0, chks_4 = chks_3; _i < chks_4.length; _i++) {
                                    var dat2 = chks_4[_i];
                                    d_1.push(dat2, false);
                                  }
                                  if (_this_1.k[0] == chks_3 && _this_1.c)
                                    _this_1.d = d_1;
                                  else
                                    d_1.push(et, true);
                                }
                              },
                              terminate: function() {
                                if (d_1 && d_1.terminate)
                                  d_1.terminate();
                              }
                            };
                            if (sc_1 >= 0)
                              file_1.size = sc_1, file_1.originalSize = su_1;
                            this_1.onfile(file_1);
                          }
                          return "break";
                        } else if (oc) {
                          if (sig == 134695760) {
                            is = i2 += 12 + (oc == -2 && 8), f = 3, this_1.c = 0;
                            return "break";
                          } else if (sig == 33639248) {
                            is = i2 -= 4, f = 3, this_1.c = 0;
                            return "break";
                          }
                        }
                      };
                      var this_1 = this;
                      for (; i2 < l - 4; ++i2) {
                        var state_1 = _loop_2();
                        if (state_1 === "break")
                          break;
                      }
                      this.p = et;
                      if (oc < 0) {
                        var dat = f ? buf.subarray(0, is - 12 - (oc == -2 && 8) - (b4(buf, is - 16) == 134695760 && 4)) : buf.subarray(0, i2);
                        if (add2)
                          add2.push(dat, !!f);
                        else
                          this.k[+(f == 2)].push(dat);
                      }
                      if (f & 2)
                        return this.push(buf.subarray(i2), final);
                      this.p = buf.subarray(i2);
                    }
                    if (final) {
                      if (this.c)
                        err(13);
                      this.p = null;
                    }
                  };
                  Unzip2.prototype.register = function(decoder) {
                    this.o[decoder.compression] = decoder;
                  };
                  return Unzip2;
                })();
                exports2.Unzip = Unzip;
                var mt = typeof queueMicrotask == "function" ? queueMicrotask : typeof setTimeout == "function" ? setTimeout : function(fn) {
                  fn();
                };
                function unzip(data, opts, cb) {
                  if (!cb)
                    cb = opts, opts = {};
                  if (typeof cb != "function")
                    err(7);
                  var term = [];
                  var tAll = function() {
                    for (var i3 = 0; i3 < term.length; ++i3)
                      term[i3]();
                  };
                  var files = {};
                  var cbd = function(a, b) {
                    mt(function() {
                      cb(a, b);
                    });
                  };
                  mt(function() {
                    cbd = cb;
                  });
                  var e = data.length - 22;
                  for (; b4(data, e) != 101010256; --e) {
                    if (!e || data.length - e > 65558) {
                      cbd(err(13, 0, 1), null);
                      return tAll;
                    }
                  }
                  ;
                  var lft = b2(data, e + 8);
                  if (lft) {
                    var c = lft;
                    var o = b4(data, e + 16);
                    var z = o == 4294967295;
                    if (z) {
                      e = b4(data, e - 12);
                      if (b4(data, e) != 101075792) {
                        cbd(err(13, 0, 1), null);
                        return tAll;
                      }
                      c = lft = b4(data, e + 32);
                      o = b4(data, e + 48);
                    }
                    var fltr = opts && opts.filter;
                    var _loop_3 = function(i3) {
                      var _a2 = zh(data, o, z), c_1 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
                      o = no;
                      var cbl = function(e2, d) {
                        if (e2) {
                          tAll();
                          cbd(e2, null);
                        } else {
                          if (d)
                            files[fn] = d;
                          if (!--lft)
                            cbd(null, files);
                        }
                      };
                      if (!fltr || fltr({
                        name: fn,
                        size: sc,
                        originalSize: su,
                        compression: c_1
                      })) {
                        if (!c_1)
                          cbl(null, slc(data, b, b + sc));
                        else if (c_1 == 8) {
                          var infl = data.subarray(b, b + sc);
                          if (sc < 32e4) {
                            try {
                              cbl(null, inflateSync(infl, new u82(su)));
                            } catch (e2) {
                              cbl(e2, null);
                            }
                          } else
                            term.push(inflate(infl, { size: su }, cbl));
                        } else
                          cbl(err(14, "unknown compression type " + c_1, 1), null);
                      } else
                        cbl(null, null);
                    };
                    for (var i2 = 0; i2 < c; ++i2) {
                      _loop_3(i2);
                    }
                  } else
                    cbd(null, {});
                  return tAll;
                }
                exports2.unzip = unzip;
                function unzipSync(data, opts) {
                  var files = {};
                  var e = data.length - 22;
                  for (; b4(data, e) != 101010256; --e) {
                    if (!e || data.length - e > 65558)
                      err(13);
                  }
                  ;
                  var c = b2(data, e + 8);
                  if (!c)
                    return {};
                  var o = b4(data, e + 16);
                  var z = o == 4294967295;
                  if (z) {
                    e = b4(data, e - 12);
                    if (b4(data, e) != 101075792)
                      err(13);
                    c = b4(data, e + 32);
                    o = b4(data, e + 48);
                  }
                  var fltr = opts && opts.filter;
                  for (var i2 = 0; i2 < c; ++i2) {
                    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
                    o = no;
                    if (!fltr || fltr({
                      name: fn,
                      size: sc,
                      originalSize: su,
                      compression: c_2
                    })) {
                      if (!c_2)
                        files[fn] = slc(data, b, b + sc);
                      else if (c_2 == 8)
                        files[fn] = inflateSync(data.subarray(b, b + sc), new u82(su));
                      else
                        err(14, "unknown compression type " + c_2);
                    }
                  }
                  return files;
                }
                exports2.unzipSync = unzipSync;
              })
            ),
            /***/
            "../node_modules/fflate/lib/worker.cjs": (
              /*!*********************************************!*\
                !*** ../node_modules/fflate/lib/worker.cjs ***!
                \*********************************************/
              /***/
              ((__unused_webpack_module, exports2) => {
                var ch2 = {};
                exports2["default"] = (function(c, id, msg, transfer, cb) {
                  var w = new Worker(ch2[id] || (ch2[id] = URL.createObjectURL(new Blob([
                    c + ';addEventListener("error",function(e){e=e.error;postMessage({$e$:[e.message,e.code,e.stack]})})'
                  ], { type: "text/javascript" }))));
                  w.onmessage = function(e) {
                    var d = e.data, ed = d.$e$;
                    if (ed) {
                      var err = new Error(ed[0]);
                      err["code"] = ed[1];
                      err.stack = ed[2];
                      cb(err, null);
                    } else
                      cb(null, d);
                  };
                  w.postMessage(msg, transfer);
                  return w;
                });
              })
            )
            /******/
          };
          var __webpack_module_cache__ = {};
          function __webpack_require__(moduleId) {
            var cachedModule = __webpack_module_cache__[moduleId];
            if (cachedModule !== void 0) {
              return cachedModule.exports;
            }
            var module2 = __webpack_module_cache__[moduleId] = {
              /******/
              // no module.id needed
              /******/
              // no module.loaded needed
              /******/
              exports: {}
              /******/
            };
            __webpack_modules__[moduleId](module2, module2.exports, __webpack_require__);
            return module2.exports;
          }
          (() => {
            __webpack_require__.g = (function() {
              if (typeof globalThis === "object") return globalThis;
              try {
                return this || new Function("return this")();
              } catch (e) {
                if (typeof window === "object") return window;
              }
            })();
          })();
          var __webpack_exports__ = {};
          (() => {
            var exports2 = __webpack_exports__;
            Object.defineProperty(exports2, "__esModule", { value: true });
            exports2.XmlUtils = exports2.VarDictionary = exports2.Int64 = exports2.ByteUtils = exports2.BinaryStream = exports2.KdbxUuid = exports2.KdbxTimes = exports2.KdbxMeta = exports2.KdbxHeader = exports2.KdbxGroup = exports2.KdbxFormat = exports2.KdbxEntry = exports2.KdbxDeletedObject = exports2.KdbxCustomData = exports2.Credentials = exports2.KdbxCredentials = exports2.KdbxContext = exports2.KdbxBinaries = exports2.Kdbx = exports2.KdbxError = exports2.XmlNames = exports2.Consts = exports2.Salsa20 = exports2.ProtectedValue = exports2.ProtectSaltGenerator = exports2.KeyEncryptorKdf = exports2.KeyEncryptorAes = exports2.HmacBlockTransform = exports2.HashedBlockTransform = exports2.CryptoEngine = exports2.ChaCha20 = void 0;
            const chacha20_1 = __webpack_require__(
              /*! ./crypto/chacha20 */
              "./crypto/chacha20.ts"
            );
            Object.defineProperty(exports2, "ChaCha20", { enumerable: true, get: function() {
              return chacha20_1.ChaCha20;
            } });
            const CryptoEngine = __webpack_require__(
              /*! ./crypto/crypto-engine */
              "./crypto/crypto-engine.ts"
            );
            exports2.CryptoEngine = CryptoEngine;
            const HashedBlockTransform = __webpack_require__(
              /*! ./crypto/hashed-block-transform */
              "./crypto/hashed-block-transform.ts"
            );
            exports2.HashedBlockTransform = HashedBlockTransform;
            const HmacBlockTransform = __webpack_require__(
              /*! ./crypto/hmac-block-transform */
              "./crypto/hmac-block-transform.ts"
            );
            exports2.HmacBlockTransform = HmacBlockTransform;
            const KeyEncryptorAes = __webpack_require__(
              /*! ./crypto/key-encryptor-aes */
              "./crypto/key-encryptor-aes.ts"
            );
            exports2.KeyEncryptorAes = KeyEncryptorAes;
            const KeyEncryptorKdf = __webpack_require__(
              /*! ./crypto/key-encryptor-kdf */
              "./crypto/key-encryptor-kdf.ts"
            );
            exports2.KeyEncryptorKdf = KeyEncryptorKdf;
            const protect_salt_generator_1 = __webpack_require__(
              /*! ./crypto/protect-salt-generator */
              "./crypto/protect-salt-generator.ts"
            );
            Object.defineProperty(exports2, "ProtectSaltGenerator", { enumerable: true, get: function() {
              return protect_salt_generator_1.ProtectSaltGenerator;
            } });
            const protected_value_1 = __webpack_require__(
              /*! ./crypto/protected-value */
              "./crypto/protected-value.ts"
            );
            Object.defineProperty(exports2, "ProtectedValue", { enumerable: true, get: function() {
              return protected_value_1.ProtectedValue;
            } });
            const salsa20_1 = __webpack_require__(
              /*! ./crypto/salsa20 */
              "./crypto/salsa20.ts"
            );
            Object.defineProperty(exports2, "Salsa20", { enumerable: true, get: function() {
              return salsa20_1.Salsa20;
            } });
            const Consts = __webpack_require__(
              /*! ./defs/consts */
              "./defs/consts.ts"
            );
            exports2.Consts = Consts;
            const XmlNames = __webpack_require__(
              /*! ./defs/xml-names */
              "./defs/xml-names.ts"
            );
            exports2.XmlNames = XmlNames;
            const kdbx_error_1 = __webpack_require__(
              /*! ./errors/kdbx-error */
              "./errors/kdbx-error.ts"
            );
            Object.defineProperty(exports2, "KdbxError", { enumerable: true, get: function() {
              return kdbx_error_1.KdbxError;
            } });
            const kdbx_1 = __webpack_require__(
              /*! ./format/kdbx */
              "./format/kdbx.ts"
            );
            Object.defineProperty(exports2, "Kdbx", { enumerable: true, get: function() {
              return kdbx_1.Kdbx;
            } });
            const kdbx_binaries_1 = __webpack_require__(
              /*! ./format/kdbx-binaries */
              "./format/kdbx-binaries.ts"
            );
            Object.defineProperty(exports2, "KdbxBinaries", { enumerable: true, get: function() {
              return kdbx_binaries_1.KdbxBinaries;
            } });
            const kdbx_context_1 = __webpack_require__(
              /*! ./format/kdbx-context */
              "./format/kdbx-context.ts"
            );
            Object.defineProperty(exports2, "KdbxContext", { enumerable: true, get: function() {
              return kdbx_context_1.KdbxContext;
            } });
            const kdbx_credentials_1 = __webpack_require__(
              /*! ./format/kdbx-credentials */
              "./format/kdbx-credentials.ts"
            );
            Object.defineProperty(exports2, "KdbxCredentials", { enumerable: true, get: function() {
              return kdbx_credentials_1.KdbxCredentials;
            } });
            Object.defineProperty(exports2, "Credentials", { enumerable: true, get: function() {
              return kdbx_credentials_1.KdbxCredentials;
            } });
            const kdbx_custom_data_1 = __webpack_require__(
              /*! ./format/kdbx-custom-data */
              "./format/kdbx-custom-data.ts"
            );
            Object.defineProperty(exports2, "KdbxCustomData", { enumerable: true, get: function() {
              return kdbx_custom_data_1.KdbxCustomData;
            } });
            const kdbx_deleted_object_1 = __webpack_require__(
              /*! ./format/kdbx-deleted-object */
              "./format/kdbx-deleted-object.ts"
            );
            Object.defineProperty(exports2, "KdbxDeletedObject", { enumerable: true, get: function() {
              return kdbx_deleted_object_1.KdbxDeletedObject;
            } });
            const kdbx_entry_1 = __webpack_require__(
              /*! ./format/kdbx-entry */
              "./format/kdbx-entry.ts"
            );
            Object.defineProperty(exports2, "KdbxEntry", { enumerable: true, get: function() {
              return kdbx_entry_1.KdbxEntry;
            } });
            const kdbx_format_1 = __webpack_require__(
              /*! ./format/kdbx-format */
              "./format/kdbx-format.ts"
            );
            Object.defineProperty(exports2, "KdbxFormat", { enumerable: true, get: function() {
              return kdbx_format_1.KdbxFormat;
            } });
            const kdbx_group_1 = __webpack_require__(
              /*! ./format/kdbx-group */
              "./format/kdbx-group.ts"
            );
            Object.defineProperty(exports2, "KdbxGroup", { enumerable: true, get: function() {
              return kdbx_group_1.KdbxGroup;
            } });
            const kdbx_header_1 = __webpack_require__(
              /*! ./format/kdbx-header */
              "./format/kdbx-header.ts"
            );
            Object.defineProperty(exports2, "KdbxHeader", { enumerable: true, get: function() {
              return kdbx_header_1.KdbxHeader;
            } });
            const kdbx_meta_1 = __webpack_require__(
              /*! ./format/kdbx-meta */
              "./format/kdbx-meta.ts"
            );
            Object.defineProperty(exports2, "KdbxMeta", { enumerable: true, get: function() {
              return kdbx_meta_1.KdbxMeta;
            } });
            const kdbx_times_1 = __webpack_require__(
              /*! ./format/kdbx-times */
              "./format/kdbx-times.ts"
            );
            Object.defineProperty(exports2, "KdbxTimes", { enumerable: true, get: function() {
              return kdbx_times_1.KdbxTimes;
            } });
            const kdbx_uuid_1 = __webpack_require__(
              /*! ./format/kdbx-uuid */
              "./format/kdbx-uuid.ts"
            );
            Object.defineProperty(exports2, "KdbxUuid", { enumerable: true, get: function() {
              return kdbx_uuid_1.KdbxUuid;
            } });
            const binary_stream_1 = __webpack_require__(
              /*! ./utils/binary-stream */
              "./utils/binary-stream.ts"
            );
            Object.defineProperty(exports2, "BinaryStream", { enumerable: true, get: function() {
              return binary_stream_1.BinaryStream;
            } });
            const ByteUtils = __webpack_require__(
              /*! ./utils/byte-utils */
              "./utils/byte-utils.ts"
            );
            exports2.ByteUtils = ByteUtils;
            const int64_1 = __webpack_require__(
              /*! ./utils/int64 */
              "./utils/int64.ts"
            );
            Object.defineProperty(exports2, "Int64", { enumerable: true, get: function() {
              return int64_1.Int64;
            } });
            const var_dictionary_1 = __webpack_require__(
              /*! ./utils/var-dictionary */
              "./utils/var-dictionary.ts"
            );
            Object.defineProperty(exports2, "VarDictionary", { enumerable: true, get: function() {
              return var_dictionary_1.VarDictionary;
            } });
            const XmlUtils = __webpack_require__(
              /*! ./utils/xml-utils */
              "./utils/xml-utils.ts"
            );
            exports2.XmlUtils = XmlUtils;
          })();
          return __webpack_exports__;
        })()
      );
    });
  }
});

// packages/locker/src/vault.ts
var import_kdbxweb2 = __toESM(require_kdbxweb(), 1);

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes(bytes));
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function rotl(word, shift) {
  return word << shift | word >>> 32 - shift >>> 0;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new TypeError("string expected");
  const encoded = new TextEncoder().encode(str);
  try {
    return new Uint8Array(encoded);
  } finally {
    clean(encoded);
  }
}
function kdfInputToBytes(data, errorTitle = "") {
  if (typeof data === "string")
    return utf8ToBytes(data);
  return abytes(data, void 0, errorTitle);
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_blake.js
var BSIGMA = /* @__PURE__ */ Uint8Array.from([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  // Blake1, unused in others
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9
]);

// node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE2) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE2 ? l : h, isLE2);
  view.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
var rotr32H = (_h, l) => l;
var rotr32L = (h, _l) => h;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE2) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE2);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/blake2.js
var B2B_IV = /* @__PURE__ */ Uint32Array.from([
  4089235720,
  1779033703,
  2227873595,
  3144134277,
  4271175723,
  1013904242,
  1595750129,
  2773480762,
  2917565137,
  1359893119,
  725511199,
  2600822924,
  4215389547,
  528734635,
  327033209,
  1541459225
]);
var BBUF = /* @__PURE__ */ new Uint32Array(32);
function G1b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L(Al, Bl, Xl);
  Ah = add3H(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotr32H(xh, xl);
  Dl = rotr32L(xh, xl);
  ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrSH(xh, xl, 24);
  Bl = rotrSL(xh, xl, 24);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function G2b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L(Al, Bl, Xl);
  Ah = add3H(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotrSH(xh, xl, 16);
  Dl = rotrSL(xh, xl, 16);
  ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrBH(xh, xl, 63);
  Bl = rotrBL(xh, xl, 63);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
  anumber(keyLen);
  if (outputLen <= 0 || outputLen > keyLen)
    throw new Error('"dkLen" must be 1..' + keyLen + ", got " + outputLen);
  const { key, salt, personalization } = opts;
  if (key !== void 0 && (key.length < 1 || key.length > keyLen))
    throw new Error('"key" expected to be undefined or of length=1..' + keyLen);
  if (salt !== void 0)
    abytes(salt, saltLen, "salt");
  if (personalization !== void 0)
    abytes(personalization, persLen, "personalization");
}
var _BLAKE2 = class {
  buffer;
  buffer32;
  finished = false;
  destroyed = false;
  length = 0;
  pos = 0;
  blockLen;
  outputLen;
  canXOF = false;
  constructor(blockLen, outputLen) {
    anumber(blockLen);
    anumber(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { blockLen, buffer, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE(data32);
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    if (out.byteOffset & 3)
      throw new RangeError('"output" expected 4-byte aligned byteOffset, got ' + out.byteOffset);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.fill(0, pos);
    swap32IfBE(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE(buffer32);
    const state = this.get();
    const out32 = out === this.buffer ? buffer32 : u32(out);
    const full = Math.floor(this.outputLen / 4);
    for (let i = 0; i < full; i++)
      out32[i] = swap8IfBE(state[i]);
    const tail = this.outputLen % 4;
    if (!tail)
      return;
    const off = full * 4;
    const word = state[full];
    for (let i = 0; i < tail; i++)
      out[off + i] = word >>> 8 * i;
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to ||= new this.constructor({ dkLen: outputLen });
    to.set(...this.get());
    to.buffer.set(buffer);
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    to.outputLen = outputLen;
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var _BLAKE2b = class extends _BLAKE2 {
  // Same IV words as SHA-512 / BLAKE2b, encoded as LE u32 low/high halves.
  v0l = B2B_IV[0] | 0;
  v0h = B2B_IV[1] | 0;
  v1l = B2B_IV[2] | 0;
  v1h = B2B_IV[3] | 0;
  v2l = B2B_IV[4] | 0;
  v2h = B2B_IV[5] | 0;
  v3l = B2B_IV[6] | 0;
  v3h = B2B_IV[7] | 0;
  v4l = B2B_IV[8] | 0;
  v4h = B2B_IV[9] | 0;
  v5l = B2B_IV[10] | 0;
  v5h = B2B_IV[11] | 0;
  v6l = B2B_IV[12] | 0;
  v6h = B2B_IV[13] | 0;
  v7l = B2B_IV[14] | 0;
  v7h = B2B_IV[15] | 0;
  constructor(opts = {}) {
    opts = checkOpts({}, opts);
    const olen = opts.dkLen === void 0 ? 64 : opts.dkLen;
    super(128, olen);
    checkBlake2Opts(olen, opts, 64, 16, 16);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== void 0) {
      abytes(key, void 0, "key");
      keyLength = key.length;
    }
    this.v0l ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== void 0) {
      abytes(salt, void 0, "salt");
      const slt = u32(copyBytes(salt));
      this.v4l ^= swap8IfBE(slt[0]);
      this.v4h ^= swap8IfBE(slt[1]);
      this.v5l ^= swap8IfBE(slt[2]);
      this.v5h ^= swap8IfBE(slt[3]);
    }
    if (personalization !== void 0) {
      abytes(personalization, void 0, "personalization");
      const pers = u32(copyBytes(personalization));
      this.v6l ^= swap8IfBE(pers[0]);
      this.v6h ^= swap8IfBE(pers[1]);
      this.v7l ^= swap8IfBE(pers[2]);
      this.v7h ^= swap8IfBE(pers[3]);
    }
    if (key !== void 0) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
      clean(tmp);
    }
  }
  // prettier-ignore
  get() {
    let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
  }
  // prettier-ignore
  set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
    this.v0l = v0l | 0;
    this.v0h = v0h | 0;
    this.v1l = v1l | 0;
    this.v1h = v1h | 0;
    this.v2l = v2l | 0;
    this.v2h = v2h | 0;
    this.v3l = v3l | 0;
    this.v3h = v3h | 0;
    this.v4l = v4l | 0;
    this.v4h = v4h | 0;
    this.v5l = v5l | 0;
    this.v5h = v5h | 0;
    this.v6l = v6l | 0;
    this.v6h = v6h | 0;
    this.v7l = v7l | 0;
    this.v7h = v7h | 0;
  }
  compress(msg, offset, isLast) {
    const { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    {
      BBUF[0] = v0l;
      BBUF[1] = v0h;
      BBUF[2] = v1l;
      BBUF[3] = v1h;
      BBUF[4] = v2l;
      BBUF[5] = v2h;
      BBUF[6] = v3l;
      BBUF[7] = v3h;
      BBUF[8] = v4l;
      BBUF[9] = v4h;
      BBUF[10] = v5l;
      BBUF[11] = v5h;
      BBUF[12] = v6l;
      BBUF[13] = v6h;
      BBUF[14] = v7l;
      BBUF[15] = v7h;
    }
    BBUF.set(B2B_IV, 16);
    const l = fromNumL(this.length);
    const h = fromNumH(this.length);
    BBUF[24] = B2B_IV[8] ^ l;
    BBUF[25] = B2B_IV[9] ^ h;
    if (isLast) {
      BBUF[28] = ~BBUF[28];
      BBUF[29] = ~BBUF[29];
    }
    let j = 0;
    const s = BSIGMA;
    for (let i = 0; i < 12; i++) {
      G1b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G2b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G1b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G2b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G1b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G2b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G1b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G2b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G1b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G2b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G1b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G2b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G1b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G2b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G1b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
      G2b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
    }
    this.v0l ^= BBUF[0] ^ BBUF[16];
    this.v0h ^= BBUF[1] ^ BBUF[17];
    this.v1l ^= BBUF[2] ^ BBUF[18];
    this.v1h ^= BBUF[3] ^ BBUF[19];
    this.v2l ^= BBUF[4] ^ BBUF[20];
    this.v2h ^= BBUF[5] ^ BBUF[21];
    this.v3l ^= BBUF[6] ^ BBUF[22];
    this.v3h ^= BBUF[7] ^ BBUF[23];
    this.v4l ^= BBUF[8] ^ BBUF[24];
    this.v4h ^= BBUF[9] ^ BBUF[25];
    this.v5l ^= BBUF[10] ^ BBUF[26];
    this.v5h ^= BBUF[11] ^ BBUF[27];
    this.v6l ^= BBUF[12] ^ BBUF[28];
    this.v6h ^= BBUF[13] ^ BBUF[29];
    this.v7l ^= BBUF[14] ^ BBUF[30];
    this.v7h ^= BBUF[15] ^ BBUF[31];
    clean(BBUF);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var blake2b = /* @__PURE__ */ createHasher((opts) => new _BLAKE2b(opts));

// node_modules/@noble/hashes/argon2.js
var AT = { Argon2d: 0, Argon2i: 1, Argon2id: 2 };
var ARGON2_SYNC_POINTS = 4;
var abytesOrZero = (buf, errorTitle = "") => {
  if (buf === void 0)
    return Uint8Array.of();
  return kdfInputToBytes(buf, errorTitle);
};
var A2_BUF = new Uint32Array(256);
function G(a, b, c, d) {
  let Al = A2_BUF[2 * a], Ah = A2_BUF[2 * a + 1];
  let Bl = A2_BUF[2 * b], Bh = A2_BUF[2 * b + 1];
  let Cl = A2_BUF[2 * c], Ch = A2_BUF[2 * c + 1];
  let Dl = A2_BUF[2 * d], Dh = A2_BUF[2 * d + 1];
  let ml = 0, mh = 0, rl = 0, xh = 0, xl = 0;
  ml = Math.imul(Al, Bl);
  mh = ((Al >>> 0) * (Bl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
  rl = (Al >>> 0) + (Bl >>> 0) + (ml << 1 >>> 0);
  Ah = Ah + Bh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
  Al = rl | 0;
  xh = Dh ^ Ah;
  xl = Dl ^ Al;
  Dh = xl;
  Dl = xh;
  ml = Math.imul(Cl, Dl);
  mh = ((Cl >>> 0) * (Dl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
  rl = (Cl >>> 0) + (Dl >>> 0) + (ml << 1 >>> 0);
  Ch = Ch + Dh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
  Cl = rl | 0;
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = xh >>> 24 | xl << 8;
  Bl = xh << 8 | xl >>> 24;
  ml = Math.imul(Al, Bl);
  mh = ((Al >>> 0) * (Bl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
  rl = (Al >>> 0) + (Bl >>> 0) + (ml << 1 >>> 0);
  Ah = Ah + Bh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
  Al = rl | 0;
  xh = Dh ^ Ah;
  xl = Dl ^ Al;
  Dh = xh >>> 16 | xl << 16;
  Dl = xh << 16 | xl >>> 16;
  ml = Math.imul(Cl, Dl);
  mh = ((Cl >>> 0) * (Dl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
  rl = (Cl >>> 0) + (Dl >>> 0) + (ml << 1 >>> 0);
  Ch = Ch + Dh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
  Cl = rl | 0;
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = xh << 1 | xl >>> 31;
  Bl = xh >>> 31 | xl << 1;
  A2_BUF[2 * a] = Al, A2_BUF[2 * a + 1] = Ah;
  A2_BUF[2 * b] = Bl, A2_BUF[2 * b + 1] = Bh;
  A2_BUF[2 * c] = Cl, A2_BUF[2 * c + 1] = Ch;
  A2_BUF[2 * d] = Dl, A2_BUF[2 * d + 1] = Dh;
}
function P(v00, v01, v02, v03, v04, v05, v06, v07, v08, v09, v10, v11, v12, v13, v14, v15) {
  G(v00, v04, v08, v12);
  G(v01, v05, v09, v13);
  G(v02, v06, v10, v14);
  G(v03, v07, v11, v15);
  G(v00, v05, v10, v15);
  G(v01, v06, v11, v12);
  G(v02, v07, v08, v13);
  G(v03, v04, v09, v14);
}
function block(x, xPos, yPos, outPos, needXor) {
  if (needXor) {
    for (let i = 0; i < 256; i++) {
      const r = x[xPos + i] ^ x[yPos + i];
      A2_BUF[i] = r;
      x[outPos + i] ^= r;
    }
  } else {
    for (let i = 0; i < 256; i++) {
      const r = x[xPos + i] ^ x[yPos + i];
      A2_BUF[i] = r;
      x[outPos + i] = r;
    }
  }
  for (let i = 0; i < 128; i += 16) {
    P(i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8, i + 9, i + 10, i + 11, i + 12, i + 13, i + 14, i + 15);
  }
  for (let i = 0; i < 16; i += 2) {
    P(i, i + 1, i + 16, i + 17, i + 32, i + 33, i + 48, i + 49, i + 64, i + 65, i + 80, i + 81, i + 96, i + 97, i + 112, i + 113);
  }
  for (let i = 0; i < 256; i++)
    x[outPos + i] ^= A2_BUF[i];
  clean(A2_BUF);
}
function Hp(A, dkLen) {
  const A8 = u8(A);
  const T = new Uint32Array(1);
  const T8 = u8(T);
  T[0] = swap8IfBE(dkLen);
  if (dkLen <= 64)
    return blake2b.create({ dkLen }).update(T8).update(A8).digest();
  const out = new Uint8Array(dkLen);
  let V = blake2b.create({}).update(T8).update(A8).digest();
  let pos = 0;
  out.set(V.subarray(0, 32));
  pos += 32;
  for (; dkLen - pos > 64; pos += 32) {
    const Vh = blake2b.create({}).update(V);
    Vh.digestInto(V);
    Vh.destroy();
    out.set(V.subarray(0, 32), pos);
  }
  out.set(blake2b(V, { dkLen: dkLen - pos }), pos);
  clean(V, T);
  return out;
}
function indexAlpha(r, s, laneLen, segmentLen, index, randL, sameLane = false) {
  let area;
  if (r === 0) {
    if (s === 0)
      area = index - 1;
    else if (sameLane)
      area = s * segmentLen + index - 1;
    else
      area = s * segmentLen + (index == 0 ? -1 : 0);
  } else if (sameLane)
    area = laneLen - segmentLen + index - 1;
  else
    area = laneLen - segmentLen + (index == 0 ? -1 : 0);
  const startPos = r !== 0 && s !== ARGON2_SYNC_POINTS - 1 ? (s + 1) * segmentLen : 0;
  const randLow = Math.imul(randL, randL);
  const randHigh = ((randL >>> 0) * (randL >>> 0) - (randLow >>> 0)) / 4294967296 + 0.5 | 0;
  const areaLow = Math.imul(area, randHigh);
  const areaHigh = ((area >>> 0) * (randHigh >>> 0) - (areaLow >>> 0)) / 4294967296 + 0.5 | 0;
  const rel = area - 1 - areaHigh;
  return (startPos + rel) % laneLen;
}
var maxUint32 = Math.pow(2, 32);
var ARGON2_DEFAULT_MEMORY = 1024 ** 2;
var ARGON2_DEFAULT_MAXMEM = ARGON2_DEFAULT_MEMORY * 1024;
function isU32(num) {
  return Number.isSafeInteger(num) && num >= 0 && num < maxUint32;
}
function argon2Opts(opts = {}) {
  opts = checkOpts({}, opts);
  const merged = {
    t: 3,
    m: ARGON2_DEFAULT_MEMORY,
    p: 1,
    version: 19,
    dkLen: 32,
    maxmem: ARGON2_DEFAULT_MAXMEM,
    asyncTick: 10
  };
  for (let [k, v] of Object.entries(opts))
    if (v !== void 0)
      merged[k] = v;
  const { dkLen, p, m, t, version, onProgress, asyncTick } = merged;
  if (!isU32(dkLen) || dkLen < 4)
    throw new Error('"dkLen" must be 4..');
  if (!isU32(p) || p < 1 || p >= Math.pow(2, 24))
    throw new Error('"p" must be 1..2^24');
  if (!isU32(m))
    throw new Error('"m" must be 0..2^32');
  if (!isU32(t) || t < 1)
    throw new Error('"t" (iterations) must be 1..2^32');
  if (onProgress !== void 0 && typeof onProgress !== "function")
    throw new Error('"onProgress" must be a function');
  anumber(asyncTick, "asyncTick");
  if (!isU32(m) || m < 8 * p)
    throw new Error('"m" (memory) must be at least 8*p bytes');
  if (version !== 16 && version !== 19)
    throw new Error('"version" must be 0x10 or 0x13, got ' + version);
  return merged;
}
function argon2InitialHash(password, salt, type, opts) {
  const ownedInputs = [];
  const BUF = new Uint32Array(1);
  const BUF8 = u8(BUF);
  let h;
  let H0;
  let succeeded = false;
  const rememberOwned = (input, bytes) => {
    if (typeof input === "string")
      ownedInputs.push(bytes);
    return bytes;
  };
  try {
    const passwordBytes = rememberOwned(password, kdfInputToBytes(password, "password"));
    const saltBytes = rememberOwned(salt, kdfInputToBytes(salt, "salt"));
    if (!isU32(passwordBytes.length))
      throw new Error('"password" must be less of length 1..4Gb');
    if (!isU32(saltBytes.length) || saltBytes.length < 8)
      throw new Error('"salt" must be of length 8..4Gb');
    if (!Object.values(AT).includes(type))
      throw new Error('"type" was invalid');
    let { p, dkLen, m, t, version, key, personalization, maxmem, onProgress, asyncTick } = argon2Opts(opts);
    const keyInput = key;
    key = rememberOwned(keyInput, abytesOrZero(keyInput, "key"));
    const personalizationInput = personalization;
    personalization = rememberOwned(personalizationInput, abytesOrZero(personalizationInput, "personalization"));
    h = blake2b.create();
    for (let item of [p, dkLen, m, t, version, type]) {
      BUF[0] = swap8IfBE(item);
      h.update(BUF8);
    }
    for (let i of [passwordBytes, saltBytes, key, personalization]) {
      BUF[0] = swap8IfBE(i.length);
      h.update(BUF8).update(i);
    }
    H0 = new Uint32Array(18);
    h.digestInto(u8(H0));
    succeeded = true;
    return { H0, p, dkLen, m, t, version, maxmem, onProgress, asyncTick };
  } finally {
    if (h)
      h.destroy();
    clean(BUF, ...ownedInputs);
    if (!succeeded && H0)
      clean(H0);
  }
}
function argon2Init(password, salt, type, opts) {
  const { H0, p, dkLen, m, t, version, maxmem, onProgress, asyncTick } = argon2InitialHash(password, salt, type, opts);
  try {
    const lanes = p;
    const mP = 4 * p * Math.floor(m / (ARGON2_SYNC_POINTS * p));
    const laneLen = Math.floor(mP / p);
    const segmentLen = Math.floor(laneLen / ARGON2_SYNC_POINTS);
    const memUsed = mP * 1024;
    if (!isU32(maxmem))
      throw new Error('"maxmem" expected <2**32, got ' + maxmem);
    if (memUsed > maxmem)
      throw new Error('"maxmem" limit was hit: memUsed(mP*1024)=' + memUsed + ", maxmem=" + maxmem);
    const B = new Uint32Array(memUsed / 4);
    for (let l = 0; l < p; l++) {
      const i = 256 * laneLen * l;
      H0[17] = swap8IfBE(l);
      H0[16] = swap8IfBE(0);
      B.set(swap32IfBE(u32(Hp(H0, 1024))), i);
      H0[16] = swap8IfBE(1);
      B.set(swap32IfBE(u32(Hp(H0, 1024))), i + 256);
    }
    let perBlock = () => {
    };
    if (onProgress) {
      const totalBlock = t * ARGON2_SYNC_POINTS * p * segmentLen - 2 * p;
      const callbackPer = Math.max(Math.floor(totalBlock / 1e4), 1);
      let blockCnt = 0;
      perBlock = () => {
        blockCnt++;
        if (onProgress && (!(blockCnt % callbackPer) || blockCnt === totalBlock))
          onProgress(blockCnt / totalBlock);
      };
    }
    return { type, mP, p, t, version, B, laneLen, lanes, segmentLen, dkLen, perBlock, asyncTick };
  } finally {
    clean(H0);
  }
}
function argon2Output(B, p, laneLen, dkLen) {
  const B_final = new Uint32Array(256);
  for (let l = 0; l < p; l++)
    for (let j = 0; j < 256; j++)
      B_final[j] ^= B[256 * (laneLen * l + laneLen - 1) + j];
  const res = Hp(swap32IfBE(B_final), dkLen);
  clean(B, B_final);
  return res;
}
function* argon2Blocks(ctx, address) {
  const { type, mP, p, t, version, B, laneLen, lanes, segmentLen, perBlock } = ctx;
  address[256 + 6] = mP;
  address[256 + 8] = t;
  address[256 + 10] = type;
  for (let r = 0; r < t; r++) {
    const needXor = r !== 0 && version === 19;
    address[256 + 0] = r;
    for (let s = 0; s < ARGON2_SYNC_POINTS; s++) {
      address[256 + 4] = s;
      const dataIndependent = type == AT.Argon2i || type == AT.Argon2id && r === 0 && s < 2;
      for (let l = 0; l < p; l++) {
        address[256 + 2] = l;
        address[256 + 12] = 0;
        let startPos = 0;
        if (r === 0 && s === 0) {
          startPos = 2;
          if (dataIndependent) {
            address[256 + 12]++;
            block(address, 256, 2 * 256, 0, false);
            block(address, 0, 2 * 256, 0, false);
          }
        }
        let offset = l * laneLen + s * segmentLen + startPos;
        for (let index = startPos; index < segmentLen; index++, offset++) {
          perBlock();
          const prev = offset % laneLen ? offset - 1 : offset + laneLen - 1;
          let randL, randH;
          if (dataIndependent) {
            let i128 = index % 128;
            if (i128 === 0) {
              address[256 + 12]++;
              block(address, 256, 2 * 256, 0, false);
              block(address, 0, 2 * 256, 0, false);
            }
            randL = address[2 * i128];
            randH = address[2 * i128 + 1];
          } else {
            const T = 256 * prev;
            randL = B[T];
            randH = B[T + 1];
          }
          const refLane = r === 0 && s === 0 ? l : randH % lanes;
          const refPos = indexAlpha(r, s, laneLen, segmentLen, index, randL, refLane == l);
          const refBlock = laneLen * refLane + refPos;
          block(B, 256 * prev, 256 * refBlock, offset * 256, needXor);
          yield;
        }
      }
    }
  }
  clean(address);
}
function argon2(type, password, salt, opts) {
  const ctx = argon2Init(password, salt, type, opts);
  const blocks = argon2Blocks(ctx, new Uint32Array(3 * 256));
  while (!blocks.next().done) {
  }
  return argon2Output(ctx.B, ctx.p, ctx.laneLen, ctx.dkLen);
}
var argon2d = (password, salt, opts = {}) => argon2(AT.Argon2d, password, salt, opts);
var argon2id = (password, salt, opts = {}) => argon2(AT.Argon2id, password, salt, opts);

// packages/locker/src/crypto.ts
var import_kdbxweb = __toESM(require_kdbxweb(), 1);
var installed = false;
function installArgon2() {
  if (installed) return;
  import_kdbxweb.default.CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type, version) => {
      const opts = {
        t: iterations,
        m: memory,
        p: parallelism,
        dkLen: length,
        version,
        maxmem: Math.max(memory * 1024 * 2, 64 * 1024 * 1024)
      };
      const derive = type === 0 ? argon2d : argon2id;
      const hash = derive(new Uint8Array(password), new Uint8Array(salt), opts);
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    }
  );
  installed = true;
}

// node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@noble/hashes/legacy.js
var SHA1_IV = /* @__PURE__ */ Uint32Array.from([
  1732584193,
  4023233417,
  2562383102,
  271733878,
  3285377520
]);
var SHA1_W = /* @__PURE__ */ new Uint32Array(80);
var _SHA1 = class extends HashMD {
  A = SHA1_IV[0] | 0;
  B = SHA1_IV[1] | 0;
  C = SHA1_IV[2] | 0;
  D = SHA1_IV[3] | 0;
  E = SHA1_IV[4] | 0;
  constructor() {
    super(64, 20, 8, false);
  }
  get() {
    const { A, B, C, D, E } = this;
    return [A, B, C, D, E];
  }
  set(A, B, C, D, E) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA1_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 80; i++)
      SHA1_W[i] = rotl(SHA1_W[i - 3] ^ SHA1_W[i - 8] ^ SHA1_W[i - 14] ^ SHA1_W[i - 16], 1);
    let { A, B, C, D, E } = this;
    for (let i = 0; i < 80; i++) {
      let F, K;
      if (i < 20) {
        F = Chi(B, C, D);
        K = 1518500249;
      } else if (i < 40) {
        F = B ^ C ^ D;
        K = 1859775393;
      } else if (i < 60) {
        F = Maj(B, C, D);
        K = 2400959708;
      } else {
        F = B ^ C ^ D;
        K = 3395469782;
      }
      const T = rotl(A, 5) + F + E + K + SHA1_W[i] | 0;
      E = D;
      D = C;
      C = rotl(B, 30);
      B = A;
      A = T;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    this.set(A, B, C, D, E);
  }
  roundClean() {
    clean(SHA1_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha1 = /* @__PURE__ */ createHasher(() => new _SHA1());

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G: G2, H } = this;
    return [A, B, C, D, E, F, G2, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G2, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G2 | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G: G2, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G2) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G2;
      G2 = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G2 = G2 + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G2, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // h -- high 32 bits, l -- low 32 bits
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and slows hashing down (measured on sha256).
  Ah = 0;
  Al = 0;
  Bh = 0;
  Bl = 0;
  Ch = 0;
  Cl = 0;
  Dh = 0;
  Dl = 0;
  Eh = 0;
  El = 0;
  Fh = 0;
  Fl = 0;
  Gh = 0;
  Gl = 0;
  Hh = 0;
  Hl = 0;
  constructor(outputLen, IV) {
    super(128, outputLen, 16, false);
    this.Ah = IV[0] | 0;
    this.Al = IV[1] | 0;
    this.Bh = IV[2] | 0;
    this.Bl = IV[3] | 0;
    this.Ch = IV[4] | 0;
    this.Cl = IV[5] | 0;
    this.Dh = IV[6] | 0;
    this.Dl = IV[7] | 0;
    this.Eh = IV[8] | 0;
    this.El = IV[9] | 0;
    this.Fh = IV[10] | 0;
    this.Fl = IV[11] | 0;
    this.Gh = IV[12] | 0;
    this.Gl = IV[13] | 0;
    this.Hh = IV[14] | 0;
    this.Hl = IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var _SHA512 = class extends SHA2_64B {
  constructor() {
    super(64, SHA512_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
var sha512 = /* @__PURE__ */ createHasher(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist(3)
);

// packages/locker/src/totp.ts
var BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(input) {
  const cleaned = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!cleaned) return new Uint8Array(0);
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Authenticator secret is not valid base32");
    value = value << 5 | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}
function parseOtpauth(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    return {
      secret: trimmed.replace(/\s+/g, ""),
      period: 30,
      digits: 6,
      algorithm: "SHA1",
      issuer: "",
      account: ""
    };
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:" || url.host.toLowerCase() !== "totp") return null;
  const secret = url.searchParams.get("secret")?.replace(/\s+/g, "") ?? "";
  if (!secret) return null;
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const colon = label.indexOf(":");
  const issuerParam = url.searchParams.get("issuer") ?? "";
  const issuer = issuerParam || (colon >= 0 ? label.slice(0, colon) : "");
  const account = colon >= 0 ? label.slice(colon + 1) : label;
  const period = positiveInt(url.searchParams.get("period"), 30);
  const digits = positiveInt(url.searchParams.get("digits"), 6);
  return {
    secret,
    period,
    digits: digits === 8 ? 8 : 6,
    algorithm: totpAlgorithm(url.searchParams.get("algorithm")),
    issuer,
    account
  };
}
function otpauthUrl(params) {
  const label = params.issuer ? `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account || params.issuer)}` : encodeURIComponent(params.account || "Locker");
  const query = new URLSearchParams({
    secret: params.secret.replace(/\s+/g, ""),
    period: String(params.period),
    digits: String(params.digits),
    algorithm: params.algorithm
  });
  if (params.issuer) query.set("issuer", params.issuer);
  return `otpauth://totp/${label}?${query.toString()}`;
}
function generateTotp(params, now = Date.now()) {
  const period = params.period > 0 ? params.period : 30;
  const digits = params.digits === 8 ? 8 : 6;
  const counter = Math.floor(Math.floor(now / 1e3) / period);
  const remaining = period - Math.floor(now / 1e3) % period;
  const key = decodeBase32(params.secret);
  return {
    code: totpDigits(key, params.algorithm, counter, digits),
    next: totpDigits(key, params.algorithm, counter + 1, digits),
    period,
    remaining,
    issuer: params.issuer,
    account: params.account
  };
}
function totpDigits(key, algorithm, counter, digits) {
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint32(0, Math.floor(counter / 4294967296));
  view.setUint32(4, counter >>> 0);
  const hash = hmac(hashFn(algorithm), key, message);
  const offset = hash[hash.length - 1] & 15;
  const truncated = (hash[offset] & 127) << 24 | (hash[offset + 1] & 255) << 16 | (hash[offset + 2] & 255) << 8 | hash[offset + 3] & 255;
  return String(truncated % 10 ** digits).padStart(digits, "0");
}
function totpAlgorithm(value) {
  const normalized = (value ?? "").toUpperCase().replace(/-/g, "").replace(/^HMAC/, "");
  if (normalized === "SHA256") return "SHA256";
  if (normalized === "SHA512") return "SHA512";
  return "SHA1";
}
function hashFn(algorithm) {
  if (algorithm === "SHA256") return sha256;
  if (algorithm === "SHA512") return sha512;
  return sha1;
}
function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// packages/locker/src/vault.ts
var RECOVERY_FIELD = "RecoveryCodes";
var OTP_FIELD = "otp";
var TOTP_SEED_FIELD = "TOTP Seed";
var TIME_OTP_SECRET = "TimeOtp-Secret-Base32";
var TIME_OTP_PERIOD = "TimeOtp-Period";
var TIME_OTP_LENGTH = "TimeOtp-Length";
var TIME_OTP_ALGORITHM = "TimeOtp-Algorithm";
var PASSKEY_RP = "KPEX_PASSKEY_RELYING_PARTY";
var PASSKEY_USERNAME = "KPEX_PASSKEY_USERNAME";
var PASSKEY_CREDENTIAL_ID = "KPEX_PASSKEY_CREDENTIAL_ID";
var PASSKEY_USER_HANDLE = "KPEX_PASSKEY_USER_HANDLE";
var PASSKEY_PRIVATE_KEY = "KPEX_PASSKEY_PRIVATE_KEY_PEM";
var PIN_FIELD = "PolymuxPinned";
var ORDER_FIELD = "PolymuxOrder";
var WRONG_PASSWORD = "Wrong master password";
var LOCKED = "Locker is locked";
var MISSING_ITEM = "That item is not in the locker";
async function createDatabase(password, name = "Locker") {
  installArgon2();
  const credentials = await credentialsFromPassword(password);
  return import_kdbxweb2.default.Kdbx.create(credentials, name);
}
async function loadDatabase(bytes, password) {
  installArgon2();
  const credentials = await credentialsFromPassword(password);
  try {
    return await import_kdbxweb2.default.Kdbx.load(bytes, credentials);
  } catch (reason) {
    if (isInvalidKey(reason)) throw new Error(WRONG_PASSWORD);
    throw reason;
  }
}
async function saveDatabase(db) {
  installArgon2();
  db.cleanup({ historyRules: true, customIcons: true, binaries: true });
  const buffer = await db.save();
  return new Uint8Array(buffer);
}
function listGroups(db) {
  const root = db.getDefaultGroup();
  const groups = [];
  for (const group of visibleGroups(db)) {
    groups.push({
      id: group.uuid.toString(),
      name: group.name?.trim() || "Group",
      parentId: !group.parentGroup || group.uuid.equals(root.uuid) ? null : group.parentGroup.uuid.toString()
    });
  }
  return groups;
}
function listItems(db) {
  const items = [];
  for (const group of visibleGroups(db)) {
    for (const entry of group.entries) {
      items.push(summarize(entry, group));
    }
  }
  items.sort(compareItems);
  return items;
}
function listTrash(db) {
  const items = [];
  for (const found of trashEntries(db)) {
    items.push(summarize(found.entry, found.group));
  }
  items.sort((a, b) => a.title.localeCompare(b.title) || a.username.localeCompare(b.username));
  return items;
}
function readItem(db, id) {
  const found = findEntry(db, id);
  return found ? summarize(found.entry, found.group) : null;
}
function readSecrets(db, id) {
  const found = findEntry(db, id);
  if (!found) throw new Error(MISSING_ITEM);
  const { entry } = found;
  return {
    password: fieldText(entry, "Password"),
    totp: totpParams(entry),
    recoveryCodes: parseRecoveryCodes(fieldText(entry, RECOVERY_FIELD)),
    passkey: readPasskey(entry)
  };
}
function totpFor(db, id, now = Date.now()) {
  const found = findEntry(db, id);
  if (!found) throw new Error(MISSING_ITEM);
  const params = totpParams(found.entry);
  return params ? generateTotp(params, now) : null;
}
function listTotp(db, now = Date.now()) {
  const codes = [];
  for (const item of listItems(db)) {
    if (!item.hasTotp) continue;
    const totp = totpFor(db, item.id, now);
    if (totp) codes.push({ id: item.id, ...totp });
  }
  return codes;
}
function otpauthFor(db, id) {
  const found = findEntry(db, id) ?? findTrashed(db, id);
  if (!found) throw new Error(MISSING_ITEM);
  const params = totpParams(found.entry);
  return params ? otpauthUrl(params) : null;
}
async function changeMasterPassword(db, password) {
  installArgon2();
  await db.credentials.setPassword(import_kdbxweb2.default.ProtectedValue.fromString(password));
}
function upsertItem(db, input) {
  const group = groupNamed(db, input.groupName);
  let entry;
  if (input.id) {
    const found = findEntry(db, input.id);
    if (!found) throw new Error(MISSING_ITEM);
    entry = found.entry;
    entry.pushHistory();
    if (found.group.uuid.toString() !== group.uuid.toString()) db.move(entry, group);
  } else {
    entry = db.createEntry(group);
  }
  entry.fields.set("Title", input.title.trim() || "Untitled");
  entry.fields.set("UserName", input.username?.trim() ?? "");
  entry.fields.set("URL", input.url?.trim() ?? "");
  entry.fields.set("Notes", input.notes ?? "");
  if (input.password !== void 0)
    entry.fields.set("Password", import_kdbxweb2.default.ProtectedValue.fromString(input.password));
  if (input.totpSecret !== void 0) writeTotp(entry, input.totpSecret);
  if (input.recoveryCodes !== void 0)
    writeProtected(entry, RECOVERY_FIELD, formatRecoveryCodes(input.recoveryCodes));
  if (input.passkey !== void 0) writePasskey(entry, input.passkey);
  entry.times.update();
  return entry.uuid.toString();
}
function removeItem(db, id) {
  const found = findEntry(db, id);
  if (!found) return false;
  db.remove(found.entry);
  return true;
}
function restoreItem(db, id) {
  const found = findTrashed(db, id);
  if (!found) return false;
  const previous = found.entry.previousParentGroup ? db.getGroup(found.entry.previousParentGroup) : void 0;
  const target = previous && !groupIsTrash(db, previous) ? previous : db.getDefaultGroup();
  db.move(found.entry, target);
  found.entry.times.update();
  return true;
}
function purgeItem(db, id) {
  const found = findTrashed(db, id);
  if (!found) return false;
  db.move(found.entry, void 0);
  return true;
}
function emptyTrash(db) {
  const ids = listTrash(db).map((item) => item.id);
  for (const id of ids) purgeItem(db, id);
  return ids.length;
}
function setPinned(db, ids, pinned) {
  let changed = 0;
  for (const id of ids) {
    const found = findEntry(db, id);
    if (!found) continue;
    if (pinned) found.entry.fields.set(PIN_FIELD, "1");
    else found.entry.fields.delete(PIN_FIELD);
    found.entry.times.update();
    changed += 1;
  }
  return changed;
}
function reorderItems(db, ids) {
  const known = new Set(listItems(db).map((item) => item.id));
  const ordered = ids.filter((id) => known.has(id));
  const rest = [...known].filter((id) => !ordered.includes(id));
  [...ordered, ...rest].forEach((id, index) => {
    const found = findEntry(db, id);
    if (!found) return;
    found.entry.fields.set(ORDER_FIELD, String(index));
    found.entry.times.update();
  });
}
async function credentialsFromPassword(password) {
  const credentials = new import_kdbxweb2.default.KdbxCredentials(
    import_kdbxweb2.default.ProtectedValue.fromString(password)
  );
  await credentials.ready;
  return credentials;
}
function isInvalidKey(reason) {
  return Boolean(
    reason && typeof reason === "object" && "code" in reason && reason.code === import_kdbxweb2.default.Consts.ErrorCodes.InvalidKey
  );
}
function visibleGroups(db) {
  const bin = db.meta.recycleBinUuid;
  const groups = [];
  for (const group of db.getDefaultGroup().allGroups()) {
    if (bin && group.uuid.equals(bin)) continue;
    if (bin && group.parentGroup && ancestryHas(group, bin)) continue;
    groups.push(group);
  }
  return groups;
}
function recycleBin(db) {
  const bin = db.meta.recycleBinUuid;
  return bin ? db.getGroup(bin) : void 0;
}
function groupIsTrash(db, group) {
  const bin = db.meta.recycleBinUuid;
  if (!bin) return false;
  return group.uuid.equals(bin) || ancestryHas(group, bin);
}
function trashEntries(db) {
  const bin = recycleBin(db);
  if (!bin) return [];
  const found = [];
  const walk = (group) => {
    for (const entry of group.entries) found.push({ entry, group });
    for (const child of group.groups) walk(child);
  };
  walk(bin);
  return found;
}
function ancestryHas(group, uuid) {
  let current = group;
  while (current) {
    if (current.uuid.equals(uuid)) return true;
    current = current.parentGroup;
  }
  return false;
}
function findEntry(db, id) {
  for (const group of visibleGroups(db)) {
    for (const entry of group.entries) {
      if (entry.uuid.toString() === id || entry.uuid.id === id) return { entry, group };
    }
  }
  return null;
}
function findTrashed(db, id) {
  for (const found of trashEntries(db)) {
    if (found.entry.uuid.toString() === id || found.entry.uuid.id === id) return found;
  }
  return null;
}
function compareItems(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
  return a.title.localeCompare(b.title) || a.username.localeCompare(b.username);
}
function groupNamed(db, name) {
  const root = db.getDefaultGroup();
  const wanted = name?.trim();
  if (!wanted || wanted === root.name) return root;
  for (const group of visibleGroups(db)) {
    if (group.name === wanted) return group;
  }
  return db.createGroup(root, wanted);
}
function summarize(entry, group) {
  const passkey = readPasskey(entry);
  return {
    id: entry.uuid.toString(),
    title: fieldText(entry, "Title") || "Untitled",
    username: fieldText(entry, "UserName"),
    url: fieldText(entry, "URL"),
    notes: fieldText(entry, "Notes"),
    groupId: group.uuid.toString(),
    groupName: group.name?.trim() || "Locker",
    hasPassword: fieldText(entry, "Password").length > 0,
    hasTotp: totpParams(entry) !== null,
    hasRecoveryCodes: parseRecoveryCodes(fieldText(entry, RECOVERY_FIELD)).length > 0,
    hasPasskey: Boolean(passkey && (passkey.relyingParty || passkey.credentialId)),
    pinned: fieldText(entry, PIN_FIELD) === "1",
    sortIndex: sortIndexOf(entry),
    updatedAt: entry.times.lastModTime?.toISOString() ?? null
  };
}
function sortIndexOf(entry) {
  const raw = fieldText(entry, ORDER_FIELD);
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
function totpParams(entry) {
  const otp = fieldText(entry, OTP_FIELD);
  const fromOtp = otp ? parseOtpauth(otp) : null;
  if (fromOtp?.secret) return fromOtp;
  const seed = fieldText(entry, TIME_OTP_SECRET) || fieldText(entry, TOTP_SEED_FIELD);
  if (!seed) return null;
  const parsed = parseOtpauth(seed);
  if (!parsed) return null;
  const period = Number(fieldText(entry, TIME_OTP_PERIOD)) || parsed.period;
  const digits = Number(fieldText(entry, TIME_OTP_LENGTH)) || parsed.digits;
  const algorithmRaw = fieldText(entry, TIME_OTP_ALGORITHM);
  return {
    ...parsed,
    period: period > 0 ? period : 30,
    digits: digits === 8 ? 8 : 6,
    algorithm: algorithmRaw.includes("256") ? "SHA256" : algorithmRaw.includes("512") ? "SHA512" : parsed.algorithm,
    issuer: parsed.issuer || fieldText(entry, "Title"),
    account: parsed.account || fieldText(entry, "UserName")
  };
}
function writeTotp(entry, secret) {
  const trimmed = secret.trim();
  if (!trimmed) {
    entry.fields.delete(OTP_FIELD);
    entry.fields.delete(TIME_OTP_SECRET);
    entry.fields.delete(TIME_OTP_PERIOD);
    entry.fields.delete(TIME_OTP_LENGTH);
    entry.fields.delete(TIME_OTP_ALGORITHM);
    return;
  }
  const params = parseOtpauth(trimmed) ?? {
    secret: trimmed.replace(/\s+/g, ""),
    period: 30,
    digits: 6,
    algorithm: "SHA1",
    issuer: fieldText(entry, "Title"),
    account: fieldText(entry, "UserName")
  };
  if (!params.issuer) params.issuer = fieldText(entry, "Title");
  if (!params.account) params.account = fieldText(entry, "UserName");
  writeProtected(entry, OTP_FIELD, otpauthUrl(params));
  writeProtected(entry, TIME_OTP_SECRET, params.secret);
  entry.fields.set(TIME_OTP_PERIOD, String(params.period));
  entry.fields.set(TIME_OTP_LENGTH, String(params.digits));
  entry.fields.set(
    TIME_OTP_ALGORITHM,
    params.algorithm === "SHA256" ? "HMAC-SHA-256" : params.algorithm === "SHA512" ? "HMAC-SHA-512" : "HMAC-SHA-1"
  );
}
function readPasskey(entry) {
  const relyingParty = fieldText(entry, PASSKEY_RP);
  const username = fieldText(entry, PASSKEY_USERNAME);
  const credentialId = fieldText(entry, PASSKEY_CREDENTIAL_ID);
  const userHandle = fieldText(entry, PASSKEY_USER_HANDLE);
  const privateKeyPem = fieldText(entry, PASSKEY_PRIVATE_KEY);
  if (!relyingParty && !credentialId && !privateKeyPem) return null;
  return { relyingParty, username, credentialId, userHandle, privateKeyPem };
}
function writePasskey(entry, passkey) {
  if (!passkey) {
    for (const field of [
      PASSKEY_RP,
      PASSKEY_USERNAME,
      PASSKEY_CREDENTIAL_ID,
      PASSKEY_USER_HANDLE,
      PASSKEY_PRIVATE_KEY
    ])
      entry.fields.delete(field);
    return;
  }
  entry.fields.set(PASSKEY_RP, passkey.relyingParty.trim());
  entry.fields.set(PASSKEY_USERNAME, passkey.username.trim());
  entry.fields.set(PASSKEY_CREDENTIAL_ID, passkey.credentialId.trim());
  entry.fields.set(PASSKEY_USER_HANDLE, passkey.userHandle?.trim() ?? "");
  if (passkey.privateKeyPem !== void 0)
    writeProtected(entry, PASSKEY_PRIVATE_KEY, passkey.privateKeyPem);
}
function writeProtected(entry, name, value) {
  if (!value) {
    entry.fields.delete(name);
    return;
  }
  entry.fields.set(name, import_kdbxweb2.default.ProtectedValue.fromString(value));
}
function fieldText(entry, name) {
  const value = entry.fields.get(name);
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.getText();
}
function parseRecoveryCodes(value) {
  return value.split(/\r?\n/).map((code) => code.trim()).filter(Boolean);
}
function formatRecoveryCodes(codes) {
  return codes.map((code) => code.trim()).filter(Boolean).join("\n");
}

// packages/locker/src/match.ts
function hostKey(hostname) {
  return hostname.replace(/\.$/, "").replace(/^www\./i, "").toLowerCase();
}
function parseSiteUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}
function entryMatchesPage(entryUrl, pageUrl) {
  const entry = parseSiteUrl(entryUrl);
  const page = parseSiteUrl(pageUrl);
  if (!entry || !page) return false;
  const stored = hostKey(entry.hostname);
  const current = hostKey(page.hostname);
  if (!stored || !current) return false;
  return current === stored || current.endsWith(`.${stored}`);
}
function matchItems(items, pageUrl) {
  return items.filter((item) => entryMatchesPage(item.url, pageUrl));
}

// packages/locker/src/checksum.ts
function vaultChecksum(bytes) {
  return bytesToHex(sha256(bytes));
}
function bytesToHex(bytes) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

// packages/locker/src/webauthn.ts
function normalizeRpId(value) {
  return hostKey(value.trim());
}
function rpIdAllowedForOrigin(rpId, origin) {
  let page;
  try {
    page = new URL(origin);
  } catch {
    return false;
  }
  const secure = page.protocol === "https:" || page.hostname === "localhost" || page.hostname === "127.0.0.1";
  if (!secure) return false;
  const rp = normalizeRpId(rpId);
  const host = normalizeRpId(page.hostname);
  if (!rp || !host) return false;
  return host === rp || host.endsWith(`.${rp}`);
}
function relyingPartyMatches(storedRpId, requestRpId) {
  const stored = normalizeRpId(storedRpId);
  const requested = normalizeRpId(requestRpId);
  return Boolean(stored && requested && stored === requested);
}
function credentialIdsEqual(left, right) {
  const a = decodeCredentialId(left);
  const b = decodeCredentialId(right);
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  return a.every((byte, index) => byte === b[index]);
}
function rpIdForOrigin(origin, rpId) {
  if (rpId?.trim()) return normalizeRpId(rpId);
  try {
    return normalizeRpId(new URL(origin).hostname);
  } catch {
    return "";
  }
}
function listPasskeysForRequest(db, request) {
  assertUnlocked(db);
  if (!rpIdAllowedForOrigin(request.rpId, request.origin)) return [];
  const allow = request.allowCredentialIds?.filter(Boolean) ?? [];
  const offers = [];
  for (const item of listItems(db)) {
    if (!item.hasPasskey) continue;
    const passkey = readSecrets(db, item.id).passkey;
    if (!passkey?.privateKeyPem || !relyingPartyMatches(passkey.relyingParty, request.rpId))
      continue;
    if (allow.length && !allow.some((id) => credentialIdsEqual(passkey.credentialId, id)))
      continue;
    offers.push(offerFrom(item.id, item.title, passkey));
  }
  return offers;
}
async function getPasskeyAssertion(db, request) {
  assertUnlocked(db);
  if (!rpIdAllowedForOrigin(request.rpId, request.origin))
    throw new Error("This site cannot use that passkey");
  const matches = listPasskeysForRequest(db, request);
  const chosen = request.itemId ? matches.find((offer) => offer.id === request.itemId) : matches[0];
  if (!chosen) throw new Error("No passkey is saved for this site");
  const passkey = readSecrets(db, chosen.id).passkey;
  if (!passkey?.privateKeyPem) throw new Error("That passkey is incomplete");
  const credentialId = decodeCredentialId(passkey.credentialId);
  if (!credentialId) throw new Error("That passkey is incomplete");
  const challenge = decodeCredentialId(request.challenge);
  if (!challenge) throw new Error("The site challenge was unreadable");
  const clientDataJSON = encodeClientData("webauthn.get", challenge, request.origin);
  const authenticatorData = buildAuthenticatorData(request.rpId, false);
  const signature = await signAssertion(passkey.privateKeyPem, authenticatorData, clientDataJSON);
  const userHandle = passkey.userHandle ? decodeCredentialId(passkey.userHandle) : null;
  return {
    id: bytesToBase64Url(credentialId),
    rawId: bytesToBase64Url(credentialId),
    type: "public-key",
    authenticatorAttachment: "platform",
    clientDataJSON: bytesToBase64Url(clientDataJSON),
    authenticatorData: bytesToBase64Url(authenticatorData),
    signature: bytesToBase64Url(signature),
    userHandle: userHandle ? bytesToBase64Url(userHandle) : null
  };
}
async function createPasskeyCredential(db, request) {
  assertUnlocked(db);
  if (!rpIdAllowedForOrigin(request.rpId, request.origin))
    throw new Error("This site cannot save a passkey");
  const exclude = request.excludeCredentialIds?.filter(Boolean) ?? [];
  if (exclude.length) {
    const existing = listPasskeysForRequest(db, {
      origin: request.origin,
      rpId: request.rpId,
      challenge: request.challenge,
      allowCredentialIds: exclude
    });
    if (existing.length) throw new Error("A passkey for this site is already saved");
  }
  const challenge = decodeCredentialId(request.challenge);
  if (!challenge) throw new Error("The site challenge was unreadable");
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const privateKeyPem = pkcs8ToPem(pkcs8);
  const credentialId = randomBytes2(32);
  const userHandle = decodeCredentialId(request.userId) ?? randomBytes2(32);
  const username = request.userName.trim() || request.userDisplayName?.trim() || "Passkey";
  const itemId = upsertItem(db, {
    title: request.rpName?.trim() || request.rpId,
    username,
    url: `https://${request.rpId}`,
    passkey: {
      relyingParty: normalizeRpId(request.rpId),
      username,
      credentialId: bytesToBase64(credentialId),
      userHandle: bytesToBase64(userHandle),
      privateKeyPem
    }
  });
  const clientDataJSON = encodeClientData("webauthn.create", challenge, request.origin);
  const cose = await coseKey(pair.publicKey);
  const authenticatorData = buildAuthenticatorData(request.rpId, true, credentialId, cose);
  const attestationObject = encodeAttestationObject(authenticatorData);
  return {
    itemId,
    attestation: {
      id: bytesToBase64Url(credentialId),
      rawId: bytesToBase64Url(credentialId),
      type: "public-key",
      authenticatorAttachment: "platform",
      clientDataJSON: bytesToBase64Url(clientDataJSON),
      attestationObject: bytesToBase64Url(attestationObject),
      transports: ["internal", "hybrid"]
    }
  };
}
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeCredentialId(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = url + "=".repeat((4 - url.length % 4) % 4);
    const bytes = base64ToBytes(padded);
    if (bytes.byteLength) return bytes;
  } catch {
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const bytes = new Uint8Array(trimmed.length / 2);
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Number.parseInt(trimmed.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  return null;
}
function offerFrom(id, title, passkey) {
  return {
    id,
    title,
    username: passkey.username || title,
    relyingParty: passkey.relyingParty,
    credentialId: passkey.credentialId,
    userHandle: passkey.userHandle
  };
}
function assertUnlocked(db) {
  if (!db) throw new Error(LOCKED);
}
function encodeClientData(type, challenge, origin) {
  const json = JSON.stringify({
    type,
    challenge: bytesToBase64Url(challenge),
    origin,
    crossOrigin: false
  });
  return new TextEncoder().encode(json);
}
function buildAuthenticatorData(rpId, attest, credentialId, cose) {
  const rpHash = sha256Sync(new TextEncoder().encode(normalizeRpId(rpId)));
  const flags = attest ? 69 : 5;
  const header = new Uint8Array(37);
  header.set(rpHash, 0);
  header[32] = flags;
  if (!attest || !credentialId || !cose) return header;
  const attested = new Uint8Array(16 + 2 + credentialId.byteLength + cose.byteLength);
  const view = new DataView(attested.buffer);
  view.setUint16(16, credentialId.byteLength, false);
  attested.set(credentialId, 18);
  attested.set(cose, 18 + credentialId.byteLength);
  const out = new Uint8Array(header.byteLength + attested.byteLength);
  out.set(header);
  out.set(attested, header.byteLength);
  return out;
}
async function signAssertion(pem, authenticatorData, clientDataJSON) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(pemToPkcs8(pem)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(clientDataJSON)));
  const payload = new Uint8Array(authenticatorData.byteLength + clientHash.byteLength);
  payload.set(authenticatorData);
  payload.set(clientHash, authenticatorData.byteLength);
  const ieee = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload)
  );
  return p1363ToDer(ieee);
}
async function coseKey(publicKey) {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const x = decodeCredentialId(jwk.x ?? "");
  const y = decodeCredentialId(jwk.y ?? "");
  if (!x || !y) throw new Error("The passkey public key could not be exported");
  return encodeCoseEc2(x, y);
}
function encodeCoseEc2(x, y) {
  return concat(
    Uint8Array.of(165),
    encodeCborUint(1),
    encodeCborUint(2),
    encodeCborUint(3),
    encodeCborInt(-7),
    encodeCborInt(-1),
    encodeCborUint(1),
    encodeCborInt(-2),
    encodeCborBytes(x),
    encodeCborInt(-3),
    encodeCborBytes(y)
  );
}
function encodeAttestationObject(authData) {
  return concat(
    Uint8Array.of(163),
    encodeCborText("fmt"),
    encodeCborText("none"),
    encodeCborText("attStmt"),
    Uint8Array.of(160),
    encodeCborText("authData"),
    encodeCborBytes(authData)
  );
}
function encodeCborUint(value) {
  if (value < 24) return Uint8Array.of(value);
  if (value < 256) return Uint8Array.of(24, value);
  return Uint8Array.of(25, value >> 8 & 255, value & 255);
}
function encodeCborInt(value) {
  if (value >= 0) return encodeCborUint(value);
  const n = -1 - value;
  if (n < 24) return Uint8Array.of(32 + n);
  if (n < 256) return Uint8Array.of(56, n);
  return Uint8Array.of(57, n >> 8 & 255, n & 255);
}
function encodeCborText(value) {
  const bytes = new TextEncoder().encode(value);
  return concat(cborLen(96, bytes.byteLength), bytes);
}
function encodeCborBytes(value) {
  return concat(cborLen(64, value.byteLength), value);
}
function cborLen(major, length) {
  if (length < 24) return Uint8Array.of(major + length);
  if (length < 256) return Uint8Array.of(major + 24, length);
  return Uint8Array.of(major + 25, length >> 8 & 255, length & 255);
}
function p1363ToDer(ieee) {
  if (ieee.byteLength !== 64) return ieee;
  const r = derInt(ieee.subarray(0, 32));
  const s = derInt(ieee.subarray(32));
  const seq = concat(r, s);
  return concat(Uint8Array.of(48, seq.byteLength), seq);
}
function derInt(raw) {
  let start = 0;
  while (start < raw.byteLength - 1 && raw[start] === 0) start += 1;
  let body = raw.subarray(start);
  if (body[0] & 128) body = concat(Uint8Array.of(0), body);
  return concat(Uint8Array.of(2, body.byteLength), body);
}
function pkcs8ToPem(pkcs8) {
  const lines = bytesToBase64(pkcs8).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----
${lines.join("\n")}
-----END PRIVATE KEY-----`;
}
function pemToPkcs8(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bytes = decodeCredentialId(body);
  if (!bytes) throw new Error("That passkey is incomplete");
  return bytes;
}
function randomBytes2(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
function sha256Sync(bytes) {
  return sha256(bytes);
}

// packages/locker/src/sync.ts
function planSync(local, remote) {
  if (!local && !remote) return { action: "noop", reason: "empty" };
  if (!remote && local) return { action: "push", reason: "cloud-empty" };
  if (!local && remote) return { action: "pull", reason: "local-empty" };
  if (!local || !remote) return { action: "noop", reason: "empty" };
  if (!local.lastSyncedAt) return { action: "pull", reason: "first-link" };
  if (remote.revision > local.revision) {
    if (!local.dirty) return { action: "pull", reason: "remote-ahead" };
    if (timestamp(local.updatedAt) > timestamp(remote.updatedAt))
      return { action: "push", reason: "local-newer-dirty" };
    return { action: "pull", reason: "remote-ahead-conflict" };
  }
  if (local.revision > remote.revision) return { action: "push", reason: "local-ahead" };
  if (local.checksum === remote.checksum) return { action: "noop", reason: "same" };
  if (local.dirty) return { action: "push", reason: "same-revision-dirty" };
  return { action: "pull", reason: "same-revision-remote" };
}
function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// packages/locker/src/meta.ts
function emptyMeta() {
  return {
    revision: 0,
    updatedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
    checksum: "",
    dirty: false,
    lastSyncedAt: null,
    storage: "account"
  };
}
function parseVaultMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 0)
    return null;
  if (typeof row.updatedAt !== "string" || typeof row.checksum !== "string") return null;
  return {
    revision: row.revision,
    updatedAt: row.updatedAt,
    checksum: row.checksum,
    dirty: row.dirty === true,
    lastSyncedAt: typeof row.lastSyncedAt === "string" ? row.lastSyncedAt : null,
    storage: row.storage === "local" ? "local" : "account"
  };
}

// packages/locker/src/session.ts
var SESSION_IDLE_SECONDS = 5 * 60;
var LockerSession = class {
  #store;
  #bytes = null;
  #meta = emptyMeta();
  #db = null;
  #idle = null;
  constructor(store) {
    this.#store = store;
  }
  async hydrate() {
    const loaded = await this.#store.load();
    if (loaded) {
      this.#bytes = loaded.bytes;
      this.#meta = loaded.meta;
    } else {
      this.#bytes = null;
      this.#meta = emptyMeta();
    }
    return this.status();
  }
  status() {
    const exists = this.#bytes !== null;
    const storage = this.#meta.storage === "local" ? "local" : "account";
    return {
      exists,
      unlocked: this.#db !== null,
      itemCount: this.#db ? listItems(this.#db).length : 0,
      idleLockSeconds: SESSION_IDLE_SECONDS,
      sync: {
        signedIn: false,
        available: false,
        state: storage === "local" ? "local" : exists ? "local" : "offline",
        storage,
        revision: this.#meta.revision,
        lastSyncedAt: this.#meta.lastSyncedAt
      }
    };
  }
  async create(password) {
    if (this.#bytes) throw new Error("A locker already exists on this device");
    if (password.length < 8) throw new Error("Use at least 8 characters");
    this.#db = await createDatabase(password, "Locker");
    await this.#persist();
    this.#armIdle();
    return this.status();
  }
  async unlock(password) {
    if (!this.#bytes) throw new Error("Create a locker first");
    this.#db = await loadDatabase(copyBuffer(this.#bytes), password);
    this.#armIdle();
    return this.status();
  }
  lock() {
    this.#clearIdle();
    this.#db = null;
    return this.status();
  }
  list() {
    const db = this.#requireOpen();
    this.#armIdle();
    return { groups: listGroups(db), items: listItems(db), trash: listTrash(db) };
  }
  reveal(id) {
    const db = this.#requireOpen();
    this.#armIdle();
    const secrets = readSecrets(db, id);
    return {
      password: secrets.password,
      totp: secrets.totp ? totpFor(db, id) : null,
      recoveryCodes: secrets.recoveryCodes,
      passkey: secrets.passkey ? {
        relyingParty: secrets.passkey.relyingParty,
        username: secrets.passkey.username,
        credentialId: secrets.passkey.credentialId,
        userHandle: secrets.passkey.userHandle
      } : null
    };
  }
  totp(id) {
    const db = this.#requireOpen();
    this.#armIdle();
    return totpFor(db, id);
  }
  codes() {
    const db = this.#requireOpen();
    this.#armIdle();
    return listTotp(db).map((row) => ({
      id: row.id,
      code: row.code,
      next: row.next,
      period: row.period,
      remaining: row.remaining
    }));
  }
  otpauth(id) {
    const db = this.#requireOpen();
    this.#armIdle();
    return otpauthFor(db, id);
  }
  matchesForUrl(url) {
    if (!this.#db) return [];
    this.#armIdle();
    return matchItems(listItems(this.#db), url);
  }
  listPasskeys(request) {
    const db = this.#requireOpen();
    this.#armIdle();
    return listPasskeysForRequest(db, request);
  }
  async getPasskey(request) {
    const db = this.#requireOpen();
    const assertion = await getPasskeyAssertion(db, request);
    this.#armIdle();
    return assertion;
  }
  async createPasskey(request) {
    const db = this.#requireOpen();
    const created = await createPasskeyCredential(db, request);
    await this.#persist();
    this.#armIdle();
    return { ...created.attestation, itemId: created.itemId };
  }
  fillFields(id) {
    const db = this.#requireOpen();
    this.#armIdle();
    const item = readItem(db, id);
    if (!item) throw new Error("That item is not in the locker");
    const secrets = readSecrets(db, id);
    return {
      username: item.username,
      password: secrets.password,
      totp: totpFor(db, id)?.code ?? null
    };
  }
  async save(input) {
    const db = this.#requireOpen();
    const id = upsertItem(db, input);
    await this.#persist();
    this.#armIdle();
    const item = readItem(db, id);
    if (!item) throw new Error("The item could not be saved");
    return item;
  }
  async remove(id) {
    const db = this.#requireOpen();
    if (!removeItem(db, id)) throw new Error("That item is not in the locker");
    await this.#persist();
    this.#armIdle();
    return this.list();
  }
  async restore(ids) {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!restoreItem(db, id)) throw new Error("That item is not in the locker");
    }
    await this.#persist();
    this.#armIdle();
    return this.list();
  }
  async purge(ids) {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!purgeItem(db, id)) throw new Error("That item is not in the locker");
    }
    await this.#persist();
    this.#armIdle();
    return this.list();
  }
  async emptyTrash() {
    const db = this.#requireOpen();
    emptyTrash(db);
    await this.#persist();
    this.#armIdle();
    return this.list();
  }
  async pin(ids, pinned) {
    const db = this.#requireOpen();
    if (setPinned(db, ids, pinned) !== ids.length) throw new Error("That item is not in the locker");
    await this.#persist();
    this.#armIdle();
    return this.list();
  }
  async reorder(ids) {
    const db = this.#requireOpen();
    reorderItems(db, ids);
    await this.#persist();
    this.#armIdle();
    return this.list();
  }
  async changePassword(current, next) {
    if (next.length < 8) throw new Error("Use at least 8 characters");
    const db = this.#requireOpen();
    if (!this.#bytes) throw new Error(LOCKED);
    await loadDatabase(copyBuffer(this.#bytes), current);
    await changeMasterPassword(db, next);
    await this.#persist();
    this.#armIdle();
    return this.status();
  }
  copyText(id, field, recoveryIndex) {
    const db = this.#requireOpen();
    this.#armIdle();
    if (field === "totp") {
      const totp = totpFor(db, id);
      if (!totp) throw new Error("This item has no authenticator code");
      return totp.code;
    }
    const item = readItem(db, id);
    if (!item) throw new Error("That item is not in the locker");
    if (field === "username") return item.username;
    if (field === "url") return item.url;
    if (field === "notes") return item.notes;
    const secrets = readSecrets(db, id);
    if (field === "recovery") {
      const code = secrets.recoveryCodes[recoveryIndex ?? -1];
      if (!code) throw new Error("That recovery code is not stored");
      return code;
    }
    if (!secrets.password) throw new Error("This item has no password");
    return secrets.password;
  }
  async setStorage(mode) {
    if (mode !== "local" && mode !== "account") throw new Error("Choose This device or Account");
    this.#meta = { ...this.#meta, storage: mode };
    if (this.#bytes) await this.#store.save(this.#bytes, this.#meta);
    return this.status();
  }
  exportBlob() {
    if (!this.#bytes) return null;
    return { bytes: bytesToBase64(this.#bytes), meta: this.#meta };
  }
  async importBlob(blob) {
    const meta = parseVaultMeta(blob.meta) ?? emptyMeta();
    const bytes = base64ToBytes(blob.bytes);
    if (!bytes.byteLength) throw new Error("That locker copy is empty");
    this.lock();
    this.#bytes = bytes;
    this.#meta = {
      ...meta,
      checksum: meta.checksum || vaultChecksum(bytes)
    };
    await this.#store.save(this.#bytes, this.#meta);
    return this.status();
  }
  async importCloud(blob) {
    return this.importBlob({
      bytes: bytesToBase64(blob.bytes),
      meta: {
        revision: blob.revision,
        updatedAt: blob.updatedAt,
        checksum: blob.checksum || vaultChecksum(blob.bytes),
        dirty: false,
        lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
        storage: "account"
      }
    });
  }
  async acknowledgePush() {
    if (!this.#bytes) return this.status();
    this.#meta = {
      ...this.#meta,
      dirty: false,
      lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      storage: this.#meta.storage === "local" ? "local" : "account"
    };
    await this.#store.save(this.#bytes, this.#meta);
    return this.status();
  }
  #requireOpen() {
    if (!this.#db) throw new Error(LOCKED);
    return this.#db;
  }
  async #persist() {
    if (!this.#db) return;
    const bytes = await saveDatabase(this.#db);
    this.#bytes = bytes;
    this.#meta = {
      revision: this.#meta.revision + 1,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      checksum: vaultChecksum(bytes),
      dirty: true,
      lastSyncedAt: this.#meta.lastSyncedAt,
      storage: this.#meta.storage === "local" ? "local" : "account"
    };
    await this.#store.save(bytes, this.#meta);
  }
  #armIdle() {
    this.#clearIdle();
    this.#idle = setTimeout(() => {
      this.lock();
    }, SESSION_IDLE_SECONDS * 1e3);
    this.#idle.unref?.();
  }
  #clearIdle() {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
  }
};
function copyBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}
function parseLockerVaultBlob(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value;
  if (typeof row.bytes !== "string" || !row.bytes) return null;
  const meta = parseVaultMeta(row.meta);
  if (!meta) return null;
  return { bytes: row.bytes, meta };
}

// packages/locker/src/config.ts
var DEFAULT_ACCOUNT_URL = "https://zeparkyoyqvjzavrejsa.supabase.co";
function resolveAccountConfig(input) {
  const url = input?.url?.trim() || DEFAULT_ACCOUNT_URL;
  const anonKey = input?.anonKey?.trim() || "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

// packages/locker/src/account.ts
var ACCOUNT_SESSION_KEY = "polymux-account:session";
var PKCE_KEY = "polymux-account:pkce";
var PolymuxAccountClient = class {
  #config;
  #storage;
  #fetch;
  #session = null;
  #status;
  constructor(options) {
    this.#config = resolveAccountConfig(options);
    this.#storage = options.storage;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#status = { signedIn: false, available: Boolean(this.#config), profile: null };
  }
  available() {
    return this.#status.available;
  }
  status() {
    return this.#status;
  }
  async restore() {
    if (!this.#config) return this.#status;
    const raw = await this.#storage.getItem(ACCOUNT_SESSION_KEY);
    const stored = parseSession(raw);
    if (!stored) {
      this.#apply(null);
      return this.#status;
    }
    this.#session = stored;
    this.#apply(stored.user);
    try {
      await this.accessToken();
    } catch {
      await this.#clearLocal();
    }
    return this.#status;
  }
  async signInWithPassword(email, password) {
    if (!this.#config) return { ...this.#status, error: unavailable() };
    try {
      const payload = await this.#authJson("/token?grant_type=password", {
        method: "POST",
        body: { email, password }
      });
      const session = asSession(payload);
      if (!session) return { ...this.#status, error: "The sign-in response was incomplete." };
      await this.#save(session);
      return this.#status;
    } catch (error) {
      return { ...this.#status, error: accountError(error) };
    }
  }
  /**
   * PKCE OAuth against the same authorize/token endpoints desktop uses.
   * `openUrl` must return the redirect URL that contains `code`.
   */
  async signInWithOAuth(provider, options) {
    if (!this.#config) return { ...this.#status, error: unavailable() };
    try {
      const verifier = generatePkceVerifier();
      const challenge = await generatePkceChallenge(verifier);
      await this.#storage.setItem(PKCE_KEY, verifier);
      const authorize = new URL("/auth/v1/authorize", this.#config.url);
      authorize.searchParams.set("provider", provider);
      authorize.searchParams.set("redirect_to", options.redirectTo);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      const redirected = await options.openUrl(authorize.href);
      const code = authCodeFromUrl(redirected);
      if (!code) {
        await this.#storage.removeItem(PKCE_KEY);
        return { ...this.#status, error: "The sign-in response did not include a code." };
      }
      const payload = await this.#authJson("/token?grant_type=pkce", {
        method: "POST",
        body: { auth_code: code, code_verifier: verifier }
      });
      await this.#storage.removeItem(PKCE_KEY);
      const session = asSession(payload);
      if (!session) return { ...this.#status, error: "The sign-in response was incomplete." };
      await this.#save(session);
      return this.#status;
    } catch (error) {
      try {
        await this.#storage.removeItem(PKCE_KEY);
      } catch {
      }
      return { ...this.#status, error: accountError(error) };
    }
  }
  async signOut() {
    const token = this.#session?.access_token;
    if (this.#config && token) {
      try {
        await this.#request(`${this.#config.url}/auth/v1/logout`, {
          method: "POST",
          token
        });
      } catch {
      }
    }
    await this.#clearLocal();
    return this.#status;
  }
  async signInWithAppleIdentity(identityToken, nonce) {
    if (!this.#config) return { ...this.#status, error: unavailable() };
    try {
      const payload = await this.#authJson("/token?grant_type=id_token", {
        method: "POST",
        body: { provider: "apple", id_token: identityToken, nonce }
      });
      const session = asSession(payload);
      if (!session) throw new Error("The sign-in response was incomplete.");
      await this.#save(session);
      return this.#status;
    } catch (error) {
      return { ...this.#status, error: accountError(error) };
    }
  }
  async signUp(email, password) {
    if (!this.#config) return { ...this.#status, error: unavailable() };
    try {
      const payload = await this.#authJson("/signup", { method: "POST", body: { email, password } });
      const session = asSession(payload);
      if (session) await this.#save(session);
      return this.#status;
    } catch (error) {
      return { ...this.#status, error: accountError(error) };
    }
  }
  async requestPasswordReset(email) {
    try {
      await this.#authJson("/recover", { method: "POST", body: { email } });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: accountError(error) };
    }
  }
  async accessToken() {
    if (!this.#config || !this.#session) return null;
    if (!sessionExpired(this.#session)) return this.#session.access_token;
    const payload = await this.#authJson("/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: this.#session.refresh_token }
    });
    const session = asSession(payload);
    if (!session) throw new Error("The account session could not be refreshed.");
    await this.#save(session);
    return session.access_token;
  }
  userId() {
    return this.#status.profile?.userId ?? null;
  }
  /** Authenticated fetch against the same project. Never logs the token. */
  async authorizedFetch(url, init = {}) {
    if (!this.#config) throw new Error(unavailable());
    const token = await this.accessToken();
    if (!token) throw new Error("Sign in to sync this locker.");
    const headers = new Headers(init.headers);
    headers.set("apikey", this.#config.anonKey);
    headers.set("Authorization", `Bearer ${token}`);
    return this.#fetch(url, { ...init, headers, cache: init.cache ?? "no-store" });
  }
  restUrl(path, query) {
    if (!this.#config) throw new Error(unavailable());
    const url = new URL(path, `${this.#config.url}/`);
    if (query) {
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    }
    return url.href;
  }
  async #save(session) {
    this.#session = session;
    await this.#storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
    this.#apply(session.user);
  }
  async #clearLocal() {
    this.#session = null;
    try {
      await this.#storage.removeItem(ACCOUNT_SESSION_KEY);
      await this.#storage.removeItem(PKCE_KEY);
    } catch {
    }
    this.#apply(null);
  }
  #apply(user) {
    this.#status = {
      signedIn: Boolean(user),
      available: Boolean(this.#config),
      profile: user ? profileFromUser(user) : null
    };
  }
  async #authJson(path, options) {
    if (!this.#config) throw new Error(unavailable());
    return this.#request(`${this.#config.url}/auth/v1${path}`, {
      method: options.method,
      json: options.body
    });
  }
  async #request(url, options) {
    if (!this.#config) throw new Error(unavailable());
    const headers = {
      apikey: this.#config.anonKey
    };
    if (options.json) headers["Content-Type"] = "application/json;charset=UTF-8";
    const token = options.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (!isPublishableKey(this.#config.anonKey))
      headers.Authorization = `Bearer ${this.#config.anonKey}`;
    const response = await this.#fetch(url, {
      method: options.method,
      headers,
      body: options.json ? JSON.stringify(options.json) : void 0,
      cache: "no-store"
    });
    if (options.binary) return response;
    let value = {};
    try {
      value = await response.json();
    } catch {
      value = {};
    }
    if (!response.ok) throw new Error(messageFromBody(value) || `Account request failed (${response.status})`);
    return value;
  }
};
function profileFromUser(user) {
  const meta = user.user_metadata ?? {};
  const email = typeof user.email === "string" ? user.email : "";
  const name = typeof meta.full_name === "string" && meta.full_name ? meta.full_name : typeof meta.name === "string" && meta.name ? meta.name : email.split("@")[0] ?? "";
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : "";
  return { userId: user.id, email, name, avatarUrl };
}
function authCodeFromUrl(value) {
  try {
    const url = new URL(value);
    return url.searchParams.get("code") || new URLSearchParams(url.hash.replace(/^#/, "")).get("code");
  } catch {
    return null;
  }
}
function unavailable() {
  return "Account sign-in is not available in this build.";
}
function isPublishableKey(key) {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}
function sessionExpired(session) {
  if (!session.expires_at) return false;
  return session.expires_at * 1e3 < Date.now() + 6e4;
}
function parseSession(raw) {
  if (!raw) return null;
  try {
    return asSession(JSON.parse(raw));
  } catch {
    return null;
  }
}
function asSession(value) {
  if (!value || typeof value !== "object") return null;
  const row = value;
  const nested = row.session && typeof row.session === "object" ? row.session : row;
  const access = nested.access_token;
  const refresh = nested.refresh_token;
  const user = nested.user ?? row.user;
  if (typeof access !== "string" || typeof refresh !== "string" || !user?.id) return null;
  const expiresIn = typeof nested.expires_in === "number" ? nested.expires_in : 0;
  const expiresAt = typeof nested.expires_at === "number" ? nested.expires_at : expiresIn ? Math.floor(Date.now() / 1e3) + expiresIn : void 0;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: expiresAt,
    user: { id: user.id, email: user.email, user_metadata: user.user_metadata }
  };
}
function messageFromBody(value) {
  if (!value || typeof value !== "object") return "";
  const row = value;
  for (const key of ["error_description", "msg", "message", "error"]) {
    if (typeof row[key] === "string" && row[key]) return String(row[key]);
  }
  return "";
}
function accountError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^(AuthApiError|AuthRetryableFetchError):\s*/i, "");
}
function generatePkceVerifier() {
  const bytes = new Uint32Array(56);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
async function generatePkceChallenge(verifier) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// packages/locker/src/cloud.ts
var LOCKER_CLOUD_BUCKET = "locker";
var LOCKER_CLOUD_TABLE = "locker_vaults";
var MISSING_CLOUD_VAULT = "This account has no locker in the cloud.";
var FetchLockerCloud = class {
  #account;
  constructor(account) {
    this.#account = account;
  }
  available() {
    return this.#account.available();
  }
  signedIn() {
    return this.#account.status().signedIn;
  }
  async pull() {
    const userId = this.#account.userId();
    if (!this.signedIn() || !userId) return null;
    const rows = await this.#json(
      this.#account.restUrl(`rest/v1/${LOCKER_CLOUD_TABLE}`, {
        select: "revision,updated_at,checksum,object_name,byte_size",
        user_id: `eq.${userId}`
      }),
      { method: "GET" }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const revision = Number(row.revision);
    const checksum = typeof row.checksum === "string" ? row.checksum : "";
    const objectName = typeof row.object_name === "string" ? row.object_name : "";
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(checksum) || objectName !== vaultObjectName(revision, checksum))
      throw new Error("The locker cloud metadata is invalid.");
    const response = await this.#account.authorizedFetch(
      this.#account.restUrl(
        `storage/v1/object/${LOCKER_CLOUD_BUCKET}/${userId}/${objectName}`
      ),
      { method: "GET" }
    );
    if (!response.ok)
      throw new Error(
        cloudError(
          await readError(response),
          "The locker could not be downloaded."
        )
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (vaultChecksum(bytes) !== checksum || Number(row.byte_size) !== bytes.byteLength)
      throw new Error("The locker cloud copy does not match its metadata.");
    return {
      bytes,
      revision,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : (/* @__PURE__ */ new Date()).toISOString(),
      checksum
    };
  }
  async push(blob) {
    const userId = this.#account.userId();
    if (!this.signedIn() || !userId)
      throw new Error("Sign in to sync this locker.");
    const checksum = vaultChecksum(blob.bytes);
    if (checksum !== blob.checksum)
      throw new Error("The locker checksum does not match its contents.");
    const objectName = vaultObjectName(blob.revision, checksum);
    const upload = await this.#account.authorizedFetch(
      this.#account.restUrl(
        `storage/v1/object/${LOCKER_CLOUD_BUCKET}/${userId}/${objectName}`
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-upsert": "false"
        },
        body: blob.bytes
      }
    );
    if (!upload.ok) {
      const message = await readError(upload);
      if (upload.status !== 409 && !/already exists|duplicate/i.test(message))
        throw new Error(
          cloudError(message, "The locker could not be uploaded.")
        );
      await this.#validateObject(
        userId,
        objectName,
        checksum,
        blob.bytes.byteLength
      );
    }
    const upsert = await this.#account.authorizedFetch(
      this.#account.restUrl(`rest/v1/${LOCKER_CLOUD_TABLE}`, {
        on_conflict: "user_id"
      }),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          user_id: userId,
          revision: blob.revision,
          updated_at: blob.updatedAt,
          checksum: blob.checksum,
          object_name: objectName,
          byte_size: blob.bytes.byteLength
        })
      }
    );
    if (!upsert.ok) throw new Error(cloudError(await readError(upsert)));
  }
  async #json(url, init) {
    const response = await this.#account.authorizedFetch(url, init);
    if (!response.ok) throw new Error(cloudError(await readError(response)));
    return await response.json();
  }
  async #validateObject(userId, objectName, checksum, byteSize) {
    const response = await this.#account.authorizedFetch(
      this.#account.restUrl(
        `storage/v1/object/${LOCKER_CLOUD_BUCKET}/${userId}/${objectName}`
      ),
      { method: "GET" }
    );
    if (!response.ok)
      throw new Error(
        cloudError(
          await readError(response),
          "The locker could not be downloaded."
        )
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== byteSize || vaultChecksum(bytes) !== checksum)
      throw new Error(
        "The existing locker cloud object does not match the upload."
      );
  }
};
function vaultObjectName(revision, checksum) {
  if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(checksum))
    throw new Error("The locker cloud metadata is invalid.");
  return `${revision}-${checksum}.kdbx`;
}
function cloudError(message, fallback) {
  if (/bucket not found|not found/i.test(message))
    return "Locker cloud storage is not set up on this account yet.";
  const cleaned = message.replace(/^(StorageApiError|PostgrestError):\s*/i, "");
  return cleaned || fallback || "The locker could not be synced.";
}
async function readError(response) {
  try {
    const value = await response.json();
    return value.error_description || value.message || value.msg || value.error || "";
  } catch {
    return "";
  }
}

// packages/locker/src/remote.ts
var DESKTOP_OFFLINE = "desktop-offline";
function isDesktopOffline(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === DESKTOP_OFFLINE);
}
function shouldUseCloudSync(storage, signedIn) {
  return signedIn && storage !== "local";
}
async function preferDesktopLoopback(desktop, fallback) {
  try {
    return { source: "desktop", value: await desktop() };
  } catch (cause) {
    if (!isDesktopOffline(cause)) throw cause;
    return { source: "device", value: await fallback() };
  }
}
async function syncSessionWithCloud(session, cloud, options = {}) {
  const current = session.status();
  if (!shouldUseCloudSync(current.sync.storage, cloud.signedIn()))
    return { status: current, missing: false };
  const remote = await cloud.pull();
  const localBlob = session.exportBlob();
  const local = localBlob ? {
    revision: localBlob.meta.revision,
    updatedAt: localBlob.meta.updatedAt,
    checksum: localBlob.meta.checksum,
    dirty: localBlob.meta.dirty,
    lastSyncedAt: localBlob.meta.lastSyncedAt
  } : null;
  const plan = options.force ? { action: options.force } : planSync(local, remote);
  if (plan.action === "pull") {
    if (options.allowPull === false) return { status: session.status(), missing: !remote && !local };
    if (!remote) return { status: session.status(), missing: !local };
    await session.importCloud(remote);
  } else if (plan.action === "push") {
    if (!localBlob) return { status: session.status(), missing: !remote };
    const bytes = base64ToBytes(localBlob.bytes);
    await cloud.push({
      bytes,
      revision: localBlob.meta.revision,
      updatedAt: localBlob.meta.updatedAt,
      checksum: localBlob.meta.checksum || vaultChecksum(bytes)
    });
    await session.acknowledgePush();
  }
  const status = session.status();
  return { status, missing: !status.exists };
}
async function pullAccountVault(session, cloud) {
  const result = await syncSessionWithCloud(session, cloud, { allowPull: true });
  if (!result.status.exists) throw new Error(MISSING_CLOUD_VAULT);
  return result.status;
}
export {
  ACCOUNT_SESSION_KEY,
  DESKTOP_OFFLINE,
  FetchLockerCloud,
  LockerSession,
  MISSING_CLOUD_VAULT,
  PolymuxAccountClient,
  authCodeFromUrl,
  base64ToBytes,
  bytesToBase64,
  createPasskeyCredential,
  getPasskeyAssertion,
  isDesktopOffline,
  listPasskeysForRequest,
  matchItems,
  parseLockerVaultBlob,
  preferDesktopLoopback,
  pullAccountVault,
  relyingPartyMatches,
  resolveAccountConfig,
  rpIdAllowedForOrigin,
  rpIdForOrigin,
  shouldUseCloudSync,
  syncSessionWithCloud
};
