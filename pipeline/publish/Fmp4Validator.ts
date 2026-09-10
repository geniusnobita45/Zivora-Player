export interface Mp4Box {
  type: string;
  offset: number;
  size: number;
  payloadOffset: number;
}

export function parseMp4Boxes(bytes: Uint8Array): Mp4Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) throw new Error("Truncated fMP4 box header");
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) {
      if (bytes.length - offset < 16) throw new Error("Truncated extended fMP4 header");
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Oversized fMP4 box");
      size = Number(large);
      header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length || !/^[ -~]{4}$/.test(type))
      throw new Error("Invalid fMP4 box bounds");
    boxes.push({ type, offset, size, payloadOffset: offset + header });
    offset += size;
  }
  if (!boxes.length) throw new Error("Empty fMP4 file");
  return boxes;
}

export function validateFmp4(bytes: Uint8Array, kind: "init" | "segment"): void {
  const boxes = parseMp4Boxes(bytes);
  const find = (type: string) => boxes.find((box) => box.type === type);
  if (kind === "init") {
    const ftyp = find("ftyp");
    const moov = find("moov");
    if (!ftyp || ftyp.size < 16 || !moov || ftyp.offset >= moov.offset)
      throw new Error("fMP4 init requires ftyp followed by moov");
    const children = parseMp4Boxes(bytes.subarray(moov.payloadOffset, moov.offset + moov.size));
    if (
      !children.some((box) => box.type === "trak") ||
      !children.some((box) => box.type === "mvex")
    )
      throw new Error("Initialization is not fragmented MP4");
  } else {
    const moof = find("moof");
    const mdat = find("mdat");
    if (
      !moof ||
      !mdat ||
      moof.offset >= mdat.offset ||
      mdat.offset + mdat.size <= mdat.payloadOffset
    )
      throw new Error("fMP4 segment requires moof followed by nonempty mdat");
    const children = parseMp4Boxes(bytes.subarray(moof.payloadOffset, moof.offset + moof.size));
    const traf = children.find((box) => box.type === "traf");
    if (!children.some((box) => box.type === "mfhd") || !traf)
      throw new Error("Fragment is missing mfhd/traf");
    const base = moof.payloadOffset;
    const track = parseMp4Boxes(
      bytes.subarray(base + traf.payloadOffset, base + traf.offset + traf.size),
    );
    for (const required of ["tfhd", "tfdt", "trun"])
      if (!track.some((box) => box.type === required))
        throw new Error(`Fragment is missing ${required}`);
  }
}
