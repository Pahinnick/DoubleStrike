const MAX_TABLE_N = 300

const logFactorialTable: number[] = new Array(MAX_TABLE_N + 1)
logFactorialTable[0] = 0
for (let i = 1; i <= MAX_TABLE_N; i++) {
  logFactorialTable[i] = logFactorialTable[i - 1] + Math.log(i)
}

function logFactorial(n: number): number {
  if (n < 0) throw new RangeError(`logFactorial: n must be >= 0, got ${n}`)
  if (n <= MAX_TABLE_N) return logFactorialTable[n]
  // Stirling's approximation fallback; not expected for realistic deck sizes.
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n)
}

/** log(C(n, k)), computed in log-space to stay numerically stable at deck-size scales. */
export function logChoose(n: number, k: number): number {
  if (n < 0 || k < 0 || k > n) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

/** C(n, k). Intended for small values (tests, debugging) — the engine itself works in log-space. */
export function choose(n: number, k: number): number {
  const logResult = logChoose(n, k)
  return logResult === -Infinity ? 0 : Math.round(Math.exp(logResult))
}

/**
 * Probability of drawing exactly `drawCounts[i]` cards from each category `i`
 * (categories of size `categorySizes[i]`, summing to `populationSize`) when
 * drawing `sampleSize` cards without replacement from the whole population.
 */
export function multivariateHypergeomPMF(
  categorySizes: number[],
  drawCounts: number[],
  populationSize: number,
  sampleSize: number,
): number {
  if (categorySizes.length !== drawCounts.length) {
    throw new RangeError('multivariateHypergeomPMF: categorySizes and drawCounts must have the same length')
  }
  if (drawCounts.reduce((sum, x) => sum + x, 0) !== sampleSize) return 0
  for (let i = 0; i < categorySizes.length; i++) {
    if (drawCounts[i] < 0 || drawCounts[i] > categorySizes[i]) return 0
  }

  let logNumerator = 0
  for (let i = 0; i < categorySizes.length; i++) {
    logNumerator += logChoose(categorySizes[i], drawCounts[i])
  }
  const logDenominator = logChoose(populationSize, sampleSize)
  return Math.exp(logNumerator - logDenominator)
}
