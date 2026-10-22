/** Quick check of nicknameFromName (prescription name -> everyday nickname). Run: npx tsx scripts/check-nicknames.ts */
import { nicknameFromName as n } from '../src/lib/prescriptionHints';

const cases: [string, string | undefined][] = [
  ['TAB. ZITEN M 20/500MG', 'Sugar tablet'], ['CAP. ROSUVAS GOLD 10MG', 'Cholesterol capsule'], ['Rosuva Gold 10', 'Cholesterol tablet'], ['Sugar tablet', undefined], ['BP tablet', undefined], ['TAB. MET XL 25MG', 'BP tablet'],
  ['TAB. ATARAX 25MG', 'Allergy tablet'], ['GEL SUCRAFIL O 100ML', 'Gas syrup'], ['Shelcal 500', 'Calcium'], ['Amlodipine 5 mg', 'BP tablet'],
  ['Pan 40', 'Gas tablet'], ['Dolo 650', 'Fever tablet'], ['Something odd', undefined], ['', undefined], ['Panadol', undefined]
];
let bad = 0;
for (const [input, want] of cases) {
  const got = n(input);
  if (got !== want) { bad++; console.log('FAIL', input, '->', got, 'want', want); }
}
console.log(bad ? `${bad} failed` : `all ${cases.length} ok`);
process.exit(bad ? 1 : 0);
