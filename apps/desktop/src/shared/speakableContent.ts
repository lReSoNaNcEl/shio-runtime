export function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text.normalize('NFKC'))
}
