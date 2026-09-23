import { readRange } from "../lib/tools/google-sheets.ts";
const SHEET_ID = "1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY";
const rows = await readRange(SHEET_ID, "МедАвеню - Лог правок!A1:H10");
console.log(JSON.stringify(rows, null, 2));
