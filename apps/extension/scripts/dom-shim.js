export class DOMParser {
  parseFromString(text, type) {
    return new globalThis.DOMParser().parseFromString(text, type);
  }
}

export class XMLSerializer {
  serializeToString(node) {
    return new globalThis.XMLSerializer().serializeToString(node);
  }
}
