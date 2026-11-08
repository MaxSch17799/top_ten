const categories = [
  "everyday",
  "social",
  "culture",
  "emotions",
  "relationships",
  "practical",
  "philosophical",
  "absurd",
];
const tones = ["light", "thoughtful", "silly"];
const difficulties = ["easy", "medium", "challenging"];
const normalized = (text) =>
  text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
export function validateWavePack(value) {
  const fail = (message) => {
    throw new Error(`Invalid Wavelength pack: ${message}`);
  };
  const string = (v, max) =>
    typeof v === "string" &&
    v === v.trim() &&
    v.length > 0 &&
    v.length <= max &&
    !/[<>\u0000-\u001f]/u.test(v);
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected an object");
  if (
    Object.keys(value).some(
      (k) =>
        ![
          "schemaVersion",
          "game",
          "packId",
          "language",
          "title",
          "development",
          "spectrums",
        ].includes(k),
    )
  )
    fail("unknown pack field");
  if (value.schemaVersion !== 1 || value.game !== "wavelength")
    fail("unsupported schema or game");
  if (!["en", "de"].includes(value.language)) fail("language must be en or de");
  if (
    !string(value.packId, 100) ||
    !/^[a-z0-9-]+$/.test(value.packId) ||
    !string(value.title, 100)
  )
    fail("invalid pack ID or title");
  if (value.development !== undefined && typeof value.development !== "boolean")
    fail("development must be boolean");
  if (
    !Array.isArray(value.spectrums) ||
    !value.spectrums.length ||
    value.spectrums.length > 10000
  )
    fail("expected 1–10000 spectrums");
  const ids = new Set(),
    pairs = new Set();
  for (const s of value.spectrums) {
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      Object.keys(s).some(
        (k) =>
          !["id", "left", "right", "category", "tone", "difficulty"].includes(
            k,
          ),
      )
    )
      fail("invalid spectrum object");
    if (!string(s.id, 100) || ids.has(s.id))
      fail("invalid or duplicate spectrum ID");
    if (
      !string(s.left, 120) ||
      !string(s.right, 120) ||
      normalized(s.left) === normalized(s.right)
    )
      fail("endpoints must be distinct, nonempty plain text");
    if (
      !categories.includes(s.category) ||
      !tones.includes(s.tone) ||
      !difficulties.includes(s.difficulty)
    )
      fail("invalid spectrum metadata");
    const key = JSON.stringify(
      [normalized(s.left), normalized(s.right)].sort(),
    );
    if (pairs.has(key)) fail("duplicate or reversed endpoint pair");
    ids.add(s.id);
    pairs.add(key);
  }
  return value;
}
