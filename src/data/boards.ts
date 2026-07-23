export interface Board {
  id: string;
  name: string;
  city: string;
  available: boolean;
}

/**
 * All 9 Punjab BISE boards share one syllabus and pairing scheme,
 * so full support for them comes from a single dataset.
 */
export const BOARDS: Board[] = [
  { id: 'lahore', name: 'BISE Lahore', city: 'Lahore', available: true },
  { id: 'gujranwala', name: 'BISE Gujranwala', city: 'Gujranwala', available: true },
  { id: 'faisalabad', name: 'BISE Faisalabad', city: 'Faisalabad', available: true },
  { id: 'multan', name: 'BISE Multan', city: 'Multan', available: true },
  { id: 'rawalpindi', name: 'BISE Rawalpindi', city: 'Rawalpindi', available: true },
  { id: 'sargodha', name: 'BISE Sargodha', city: 'Sargodha', available: true },
  { id: 'bahawalpur', name: 'BISE Bahawalpur', city: 'Bahawalpur', available: true },
  { id: 'dgkhan', name: 'BISE D.G. Khan', city: 'Dera Ghazi Khan', available: true },
  { id: 'sahiwal', name: 'BISE Sahiwal', city: 'Sahiwal', available: true },
  { id: 'federal', name: 'FBISE (Federal)', city: 'Islamabad', available: false },
  { id: 'karachi', name: 'BSEK Karachi', city: 'Karachi', available: false },
  { id: 'peshawar', name: 'BISE Peshawar', city: 'Peshawar', available: false },
];
