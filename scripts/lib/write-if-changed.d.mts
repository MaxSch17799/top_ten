/** Write generated text only when its encoded bytes differ. Parent directories must exist. */
export function writeIfChanged(file: string | URL, content: string, encoding?: BufferEncoding): Promise<boolean>;
