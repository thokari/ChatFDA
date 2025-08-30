// Insert a single space after sentence-ending punctuation when it's missing
// Examples fixed: ")Alternatively" -> ") Alternatively", ".Next" -> ". Next"
export function addMissingSentenceSpaces(s: string): string {
    // If punctuation is immediately followed by a non-space letter or asterisk, insert a space
    // Punctuation includes ), ], quotes, period, exclamation, question
    return s.replace(/([)\]"'”’.!?])(?!\s)(?=[A-Za-z*])/g, "$1 ")
}
