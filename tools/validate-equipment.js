// Walidacja wyposażenia: katalog (data/equipment.json) i odwołania `ref` w jednostkach i kontaktach.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalog, indexCatalog, checkEquipmentRef } from '../shared/equipment.js';

export const CATALOG_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'equipment.json');

/** Wczytuje i sprawdza katalog; błędy trafiają do `report`. Zwraca indeks (pusty, gdy katalog jest niepoprawny). */
export async function loadCatalogIndex(report, file = CATALOG_FILE) {
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    report.error(`data/equipment.json: ${err.code === 'ENOENT' ? 'brak katalogu wyposażenia' : 'niepoprawny JSON (' + err.message + ')'}`);
    return new Map();
  }
  const errors = checkCatalog(catalog);
  for (const e of errors) report.error(`data/equipment.json: ${e}`);
  return errors.length ? new Map() : indexCatalog(catalog);
}

const LISTS = [['units', 'equipment'], ['contacts', 'estimate_equipment']];

/** `ref` w equipment[] jednostek i estimate_equipment[] kontaktów musi wskazywać pozycję katalogu. */
export function checkEquipmentRefs(label, data, index, report) {
  for (const [key, field] of LISTS) {
    for (const [i, item] of (Array.isArray(data?.[key]) ? data[key] : []).entries()) {
      for (const [j, entry] of (Array.isArray(item?.[field]) ? item[field] : []).entries()) {
        const error = checkEquipmentRef(entry, index);
        if (error) report.error(`${label} ${key}[${item?.id ?? i}] ${field}[${entry?.name ?? j}]: ${error}`);
      }
    }
  }
}
