interface BencodeDictionary {
  [key: string]: BencodeValue;
}

interface BencodeList extends Array<BencodeValue> {}

type BencodeValue = number | Uint8Array | BencodeList | BencodeDictionary;

const textDecoder = new TextDecoder();

function parseNumber(source: Uint8Array, start: number, endMarker: number) {
  let cursor = start;
  let raw = '';
  while (cursor < source.length && source[cursor] !== endMarker) {
    raw += String.fromCharCode(source[cursor]);
    cursor += 1;
  }
  if (cursor >= source.length) {
    throw new Error('无效的 bencode 数字结构');
  }
  return {
    value: Number.parseInt(raw, 10),
    nextIndex: cursor + 1,
  };
}

function parseByteString(source: Uint8Array, start: number) {
  const { value: length, nextIndex } = parseNumber(source, start, 58);
  if (!Number.isFinite(length) || length < 0) {
    throw new Error('无效的 bencode 字符串长度');
  }
  const endIndex = nextIndex + length;
  if (endIndex > source.length) {
    throw new Error('bencode 字符串越界');
  }
  return {
    value: source.slice(nextIndex, endIndex),
    nextIndex: endIndex,
  };
}

function parseBencodeValue(source: Uint8Array, start: number): { value: BencodeValue; nextIndex: number } {
  const token = source[start];
  if (token === 105) {
    return parseNumber(source, start + 1, 101);
  }
  if (token === 108) {
    const list: BencodeValue[] = [];
    let cursor = start + 1;
    while (cursor < source.length && source[cursor] !== 101) {
      const next = parseBencodeValue(source, cursor);
      list.push(next.value);
      cursor = next.nextIndex;
    }
    if (cursor >= source.length) {
      throw new Error('无效的 bencode 列表结构');
    }
    return { value: list, nextIndex: cursor + 1 };
  }
  if (token === 100) {
    const dict: Record<string, BencodeValue> = {};
    let cursor = start + 1;
    while (cursor < source.length && source[cursor] !== 101) {
      const keyResult = parseByteString(source, cursor);
      const key = textDecoder.decode(keyResult.value);
      const valueResult = parseBencodeValue(source, keyResult.nextIndex);
      dict[key] = valueResult.value;
      cursor = valueResult.nextIndex;
    }
    if (cursor >= source.length) {
      throw new Error('无效的 bencode 字典结构');
    }
    return { value: dict, nextIndex: cursor + 1 };
  }
  if (token >= 48 && token <= 57) {
    return parseByteString(source, start);
  }
  throw new Error('不支持的 bencode 类型');
}

function isBencodeDict(value: BencodeValue | undefined): value is Record<string, BencodeValue> {
  return !!value && !Array.isArray(value) && !(value instanceof Uint8Array) && typeof value === 'object';
}

export function getTorrentContentSizeFromBytes(bytes: Uint8Array): number | null {
  try {
    const root = parseBencodeValue(bytes, 0).value;
    if (!isBencodeDict(root)) return null;
    const info = root.info;
    if (!isBencodeDict(info)) return null;
    if (typeof info.length === 'number' && Number.isFinite(info.length) && info.length >= 0) {
      return info.length;
    }
    if (!Array.isArray(info.files)) return null;
    const total = info.files.reduce<number>((sum, item) => {
      if (!isBencodeDict(item)) return sum;
      const length = item.length;
      if (typeof length !== 'number' || !Number.isFinite(length) || length < 0) {
        return sum;
      }
      return sum + length;
    }, 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}
