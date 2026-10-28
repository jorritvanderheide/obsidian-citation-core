import { describe, expect, it } from 'vitest';
import { bibEntries, byline } from '../src/core/bibliography';
import { bibKeys } from '../src/core/citations';

// As Better BibTeX exports them: biblatex, Unicode as it is.
const BIB = `\uFEFF@comment{jabref-meta: x}

@article{jacobsAuthenticityCrisis2024,
  title = {The {{Authenticity Crisis}}},
  author = {Jacobs, Bart},
  date = {2024-07},
  journaltitle = {Computer Law \\& Security Review},
}

@book{heide2020,
  title = "Archives, {and} their readers",
  author = {Jorrit van der Heide and Marsh, Ann and others},
  year = 2020,
}

@incollection(okafor2019,
  title = {Na{\\"\\i}ve {\\'E}tudes \\& Care},
  editor = {Okafor, Ngozi and Lee, Sam},
  year = {2019}
)

@report{who2023,
  title = {Trust} # { in } # "Health",
  author = {{World Health Organization}},
  date = {2023},
}
`;

describe('bibEntries', () => {
	const entries = bibEntries(BIB);

	it('reads every work, and no other entry, in the file’s order', () => {
		expect(entries.map((entry) => entry.key)).toEqual(['jacobsAuthenticityCrisis2024', 'heide2020', 'okafor2019', 'who2023']);
	});

	it('reads only works the filter would read a key from', () => {
		const keys = bibKeys(BIB);
		for (const entry of entries) expect(keys.has(entry.key)).toBe(true);
	});

	it('reads the title as plain text', () => {
		expect(entries[0]?.title).toBe('The Authenticity Crisis');
		expect(entries[1]?.title).toBe('Archives, and their readers');
		expect(entries[2]?.title).toBe('Naïve Études & Care');
		expect(entries[3]?.title).toBe('Trust in Health');
	});

	it('reads family names, either way round, and an institution whole', () => {
		expect(entries[0]).toMatchObject({ names: ['Jacobs'], more: false, year: '2024' });
		expect(entries[1]).toMatchObject({ names: ['van der Heide', 'Marsh'], more: true, year: '2020' });
		expect(entries[3]).toMatchObject({ names: ['World Health Organization'], year: '2023' });
	});

	it('takes the editors when there are no authors', () => {
		expect(entries[2]).toMatchObject({ names: ['Okafor', 'Lee'], year: '2019' });
	});

	it('reads an entry without names or a year', () => {
		expect(bibEntries('@misc{bare,\n  title = {Bare}\n}')).toEqual([{ key: 'bare', names: [], more: false, year: '', title: 'Bare' }]);
	});
});

describe('byline', () => {
	const entry = (names: string[], more = false) => ({ key: 'k', names, more, year: '2024', title: '' });

	it('says who and when, as a citation would', () => {
		expect(byline(entry(['Marsh']))).toBe('Marsh 2024');
		expect(byline(entry(['Marsh', 'Lee']))).toBe('Marsh and Lee 2024');
		expect(byline(entry(['Marsh', 'Lee', 'Okafor']))).toBe('Marsh et al. 2024');
		expect(byline(entry(['Marsh', 'Lee'], true))).toBe('Marsh et al. 2024');
		expect(byline({ key: 'k', names: [], more: false, year: '', title: '' })).toBe('');
	});
});
