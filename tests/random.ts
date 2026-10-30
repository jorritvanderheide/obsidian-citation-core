// Choices from a seed, the same ones every run, for the tests that make up
// their own inputs: a failure found once is found again.

export interface Random {
	/** A whole number from `low` to `high`, both included. */
	int: (low: number, high: number) => number;
	/** True with the chance `p`, from 0 to 1. */
	chance: (p: number) => boolean;
	/** One of the items, or what one of the functions makes. */
	pick: <T>(items: readonly (T | (() => T))[]) => T;
}

/** Choices from a seed (mulberry32). */
export function random(seed: number): Random {
	const next = () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
	return {
		int,
		chance: (p) => next() < p,
		pick: <T>(items: readonly (T | (() => T))[]) => {
			const item = items[int(0, items.length - 1)]!;
			return typeof item === 'function' ? (item as () => T)() : item;
		},
	};
}
