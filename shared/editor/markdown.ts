const markdownPatterns = [
  /^:::details(?:Summary|Content)?\s*$/m,
  /^\s{0,3}#{1,6}\s+\S/m,
  /^\s{0,3}(?:[-+*]|\d+[.)])\s+\S/m,
  /^\s{0,3}>\s+\S/m,
  /^\s{0,3}```[^\n]*$/m,
  /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m,
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /\[[^\]\n]+\]\([^)\n]+\)/,
]

const markdownTablePattern =
  /^\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m

export function looksLikeMarkdown(text: string) {
  if (!text.trim()) return false
  return markdownTablePattern.test(text) || markdownPatterns.some((pattern) => pattern.test(text))
}
