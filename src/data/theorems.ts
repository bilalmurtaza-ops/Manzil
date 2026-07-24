/**
 * Punjab PCTB Matric Mathematics — Theorem Dojo Dataset
 *
 * All theorems verified against:
 *  - Official PCTB Class 10 Mathematics textbook (traditional book, used 2026)
 *  - Punjab BISE 2026 pairing scheme (Q9 compulsory theorem: Chapters 9 & 12)
 *  - SNC Class 9 Mathematics textbook (new 2025-26 curriculum)
 *
 * Class 10: Q9 in every Punjab board paper is a compulsory 8-mark theorem proof.
 * Students choose one theorem to prove in full (Given → To Prove → Construction → Proof).
 *
 * Proof steps are stored in correct logical order. The UI shuffles them for the puzzle.
 */

import type { ClassLevel } from '../lib/types';

export interface ProofStep {
  id: string;
  /** The mathematical statement for this step (e.g. "OA = OB (radii)") */
  statement: string;
  /** The justification / reason (e.g. "All radii of a circle are equal") */
  reason: string;
}

export interface Theorem {
  id: string;
  classLevel: ClassLevel;
  chapterNo: number;
  chapterName: string;
  /** Short display title shown in list */
  title: string;
  /** Exact statement as it appears in the PCTB book */
  fullStatement: string;
  /** The Given conditions */
  given: string;
  /** What must be proved */
  toProve: string;
  /** Construction steps (null if no construction needed) */
  construction: string | null;
  /** Proof steps in correct logical order — UI will shuffle these */
  steps: ProofStep[];
  /** Board exam marks (always 8 for compulsory theorem) */
  marks: 8;
  /** Brief hint if a student gets stuck */
  hint: string;
}

const step = (id: string, statement: string, reason: string): ProofStep => ({
  id,
  statement,
  reason,
});

export const THEOREMS: Theorem[] = [
  // ─────────────────────────────────────────────────────────────
  // CLASS 10 — Chapter 9: Chords of a Circle
  // ─────────────────────────────────────────────────────────────
  {
    id: 'th-9-1',
    classLevel: '10',
    chapterNo: 9,
    chapterName: 'Chords of a Circle',
    title: 'One circle through three non-collinear points',
    fullStatement:
      'One and only one circle can pass through three non-collinear points.',
    given: 'A, B, and C are three non-collinear points in a plane.',
    toProve:
      'One and only one circle can pass through A, B, and C.',
    construction:
      'Join AB and BC. Draw perpendicular bisectors DF of AB and HK of BC. Let them intersect at O. Join O to A, B, and C.',
    marks: 8,
    hint: 'A perpendicular bisector is the key — every point on it is equidistant from the two endpoints.',
    steps: [
      step('th-9-1-s1', 'Every point on DF is equidistant from A and B', 'Property of perpendicular bisector'),
      step('th-9-1-s2', 'O lies on DF → OA = OB', 'From Step 1'),
      step('th-9-1-s3', 'Every point on HK is equidistant from B and C', 'Property of perpendicular bisector'),
      step('th-9-1-s4', 'O lies on HK → OB = OC', 'From Step 3'),
      step('th-9-1-s5', 'OA = OB = OC', 'Transitive property (Steps 2 & 4)'),
      step('th-9-1-s6', 'A circle with centre O and radius OA passes through A, B, and C', 'Definition of circle'),
      step('th-9-1-s7', 'O is unique (two distinct lines meet at one point) → the circle is unique', 'Two perpendicular bisectors intersect at exactly one point'),
    ],
  },

  {
    id: 'th-9-2',
    classLevel: '10',
    chapterNo: 9,
    chapterName: 'Chords of a Circle',
    title: 'Line from centre to midpoint of chord is ⊥',
    fullStatement:
      'A straight line drawn from the centre of a circle to bisect a chord (which is not a diameter) is perpendicular to the chord.',
    given: 'M is the midpoint of chord AB (AB is not a diameter). O is the centre of the circle.',
    toProve: 'OM ⊥ AB  (i.e., m∠OMA = 90°)',
    construction: 'Join O with A and B.',
    marks: 8,
    hint: 'Use SSS congruence — you have OA = OB (radii), AM = BM (given), and OM = OM (common).',
    steps: [
      step('th-9-2-s1', 'OA = OB', 'Radii of the same circle are equal'),
      step('th-9-2-s2', 'AM = BM', 'Given — M is the midpoint of AB'),
      step('th-9-2-s3', 'OM = OM', 'Common side'),
      step('th-9-2-s4', '△OMA ≅ △OMB', 'SSS postulate (Steps 1, 2, 3)'),
      step('th-9-2-s5', '∠OMA = ∠OMB', 'Corresponding angles of congruent triangles'),
      step('th-9-2-s6', '∠OMA = ∠OMB = 90°  →  OM ⊥ AB', '∠OMA + ∠OMB = 180° (angles on a straight line); equal supplementary angles must each be 90°'),
    ],
  },

  {
    id: 'th-9-3',
    classLevel: '10',
    chapterNo: 9,
    chapterName: 'Chords of a Circle',
    title: 'Perpendicular from centre bisects the chord',
    fullStatement:
      'Perpendicular from the centre of a circle on a chord bisects it.',
    given: 'AB is a chord of a circle with centre O. OM ⊥ AB.',
    toProve: 'M is the midpoint of AB  (i.e., AM = BM)',
    construction: 'Join O with A and B.',
    marks: 8,
    hint: 'Use H.S ≅ H.S — both right triangles share hypotenuse OA = OB (radii) and side OM = OM.',
    steps: [
      step('th-9-3-s1', '∠OMA = ∠OMB = 90°', 'Given — OM ⊥ AB'),
      step('th-9-3-s2', 'OA = OB', 'Radii of the same circle'),
      step('th-9-3-s3', 'OM = OM', 'Common side'),
      step('th-9-3-s4', '△OMA ≅ △OMB', 'H.S ≅ H.S (hypotenuse-side congruence, Steps 1, 2, 3)'),
      step('th-9-3-s5', 'AM = BM', 'Corresponding sides of congruent triangles'),
      step('th-9-3-s6', 'M is the midpoint of AB', 'Definition of midpoint (AM = BM)'),
    ],
  },

  {
    id: 'th-9-4',
    classLevel: '10',
    chapterNo: 9,
    chapterName: 'Chords of a Circle',
    title: 'Equal chords are equidistant from centre',
    fullStatement:
      'If two chords of a circle are congruent, then they will be equidistant from the centre.',
    given: 'AB and CD are two equal chords of a circle with centre O. OH ⊥ AB and OK ⊥ CD.',
    toProve: 'OH = OK  (the chords are equidistant from the centre)',
    construction: 'Join O with A and with C.',
    marks: 8,
    hint: 'The perpendicular halves each chord — so if the chords are equal, their halves are equal. Then use H.S ≅ H.S.',
    steps: [
      step('th-9-4-s1', 'AH = ½ AB  and  CK = ½ CD', 'Perpendicular from centre bisects chord (Theorem 9.3)'),
      step('th-9-4-s2', 'AB = CD  →  AH = CK', 'Given AB = CD; halves of equal quantities are equal'),
      step('th-9-4-s3', 'OA = OC', 'Radii of the same circle'),
      step('th-9-4-s4', '∠OHA = ∠OKC = 90°', 'Given — OH ⊥ AB and OK ⊥ CD'),
      step('th-9-4-s5', '△OHA ≅ △OKC', 'H.S ≅ H.S (Steps 2, 3, 4)'),
      step('th-9-4-s6', 'OH = OK', 'Corresponding sides of congruent triangles'),
      step('th-9-4-s7', 'The two chords are equidistant from the centre', 'Definition — distance from centre = perpendicular length'),
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CLASS 10 — Chapter 12: Angle in a Segment of a Circle
  // ─────────────────────────────────────────────────────────────
  {
    id: 'th-12-1',
    classLevel: '10',
    chapterNo: 12,
    chapterName: 'Angle in a Segment of a Circle',
    title: 'Central angle = 2 × inscribed angle',
    fullStatement:
      'The measure of a central angle of a minor arc of a circle is double that of the angle subtended by the corresponding major arc.',
    given: 'Arc AC of a circle with centre O. ∠AOC is the central angle. ∠ABC is the inscribed (circumscribed) angle on the major arc.',
    toProve: 'm∠AOC = 2 × m∠ABC',
    construction: 'Join B to O and produce BO to meet the circle at point D.',
    marks: 8,
    hint: 'The key is the exterior angle theorem applied twice — once in △OAB and once in △OBC.',
    steps: [
      step('th-12-1-s1', 'In △OAB: OA = OB (radii)  →  ∠OAB = ∠OBA', 'Base angles of an isosceles triangle are equal'),
      step('th-12-1-s2', '∠AOD = ∠OAB + ∠OBA = 2 × ∠OBA', 'Exterior angle of △OAB equals sum of two non-adjacent interior angles'),
      step('th-12-1-s3', 'In △OBC: OB = OC (radii)  →  ∠OBC = ∠OCB', 'Base angles of an isosceles triangle are equal'),
      step('th-12-1-s4', '∠DOC = ∠OBC + ∠OCB = 2 × ∠OBC', 'Exterior angle of △OBC equals sum of two non-adjacent interior angles'),
      step('th-12-1-s5', '∠AOD + ∠DOC = 2 × ∠OBA + 2 × ∠OBC = 2(∠OBA + ∠OBC)', 'Adding Steps 2 and 4'),
      step('th-12-1-s6', '∠AOC = 2 × ∠ABC', '∠AOC = ∠AOD + ∠DOC  and  ∠ABC = ∠OBA + ∠OBC'),
      step('th-12-1-s7', 'The central angle is twice the inscribed angle', 'Conclusion from Step 6'),
    ],
  },

  {
    id: 'th-12-2',
    classLevel: '10',
    chapterNo: 12,
    chapterName: 'Angle in a Segment of a Circle',
    title: 'Angles in the same segment are equal',
    fullStatement:
      'Any two angles in the same segment of a circle are equal.',
    given: '∠ACB and ∠ADB are angles in the same segment (major segment) of a circle with centre O.',
    toProve: 'm∠ACB = m∠ADB',
    construction: 'Join A and B with centre O to form the central angle ∠AOB.',
    marks: 8,
    hint: 'Both inscribed angles subtend the same chord AB, so both equal half the central angle ∠AOB.',
    steps: [
      step('th-12-2-s1', '∠AOB = 2 × ∠ACB', 'Central angle is twice the inscribed angle (Theorem 12.1)'),
      step('th-12-2-s2', '∠AOB = 2 × ∠ADB', 'Same theorem applied to ∠ADB'),
      step('th-12-2-s3', '2 × ∠ACB = 2 × ∠ADB', 'Both equal ∠AOB (Steps 1 & 2)'),
      step('th-12-2-s4', '∠ACB = ∠ADB', 'Dividing both sides by 2'),
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CLASS 9 — Chapter 9: Similar Figures (SNC New Curriculum)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'th-s9-1',
    classLevel: '9',
    chapterNo: 9,
    chapterName: 'Similar Figures',
    title: 'AA Similarity of Triangles',
    fullStatement:
      'If two angles of one triangle are equal to two angles of another triangle, then the triangles are similar (AAA postulate).',
    given: 'In △ABC and △DEF: ∠A = ∠D and ∠B = ∠E.',
    toProve: '△ABC ~ △DEF  (the triangles are similar)',
    construction: null,
    marks: 8,
    hint: 'If two pairs of angles are equal, the third pair must also be equal (angle sum = 180°). Similar triangles have proportional sides.',
    steps: [
      step('th-s9-1-s1', '∠A + ∠B + ∠C = 180°', 'Sum of angles of a triangle'),
      step('th-s9-1-s2', '∠D + ∠E + ∠F = 180°', 'Sum of angles of a triangle'),
      step('th-s9-1-s3', '∠A = ∠D  and  ∠B = ∠E  →  ∠C = ∠F', 'Subtracting equal quantities from 180°'),
      step('th-s9-1-s4', 'All three corresponding angles are equal: ∠A = ∠D, ∠B = ∠E, ∠C = ∠F', 'Steps 1, 2, 3'),
      step('th-s9-1-s5', '△ABC ~ △DEF', 'AAA similarity postulate — equal angles imply similar triangles'),
    ],
  },

  {
    id: 'th-s9-2',
    classLevel: '9',
    chapterNo: 9,
    chapterName: 'Similar Figures',
    title: 'Basic Proportionality Theorem',
    fullStatement:
      'If a line is drawn parallel to one side of a triangle, it divides the other two sides proportionally.',
    given: 'In △ABC, DE ∥ BC where D is on AB and E is on AC.',
    toProve: 'AD/DB = AE/EC',
    construction: null,
    marks: 8,
    hint: 'The parallel line creates a smaller triangle similar to the original. Use the properties of similar triangles.',
    steps: [
      step('th-s9-2-s1', '∠ADE = ∠ABC', 'Corresponding angles — DE ∥ BC'),
      step('th-s9-2-s2', '∠AED = ∠ACB', 'Corresponding angles — DE ∥ BC'),
      step('th-s9-2-s3', '∠A = ∠A', 'Common angle'),
      step('th-s9-2-s4', '△ADE ~ △ABC', 'AAA similarity (Steps 1, 2, 3)'),
      step('th-s9-2-s5', 'AD/AB = AE/AC', 'Corresponding sides of similar triangles are proportional'),
      step('th-s9-2-s6', 'AD/(AB − AD) = AE/(AC − AE)  →  AD/DB = AE/EC', 'Properties of proportion (dividendo)'),
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CLASS 9 — Chapter 11: Loci and Construction (SNC New Curriculum)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'th-l9-1',
    classLevel: '9',
    chapterNo: 11,
    chapterName: 'Loci and Construction',
    title: 'Perpendicular bisector locus',
    fullStatement:
      'Any point equidistant from two given points lies on the perpendicular bisector of the segment joining them.',
    given: 'Points A and B. Point P such that PA = PB.',
    toProve: 'P lies on the perpendicular bisector of AB.',
    construction: 'Let M be the midpoint of AB. Join P to M.',
    marks: 8,
    hint: 'Show PM ⊥ AB using congruent triangles (SSS) with the midpoint M.',
    steps: [
      step('th-l9-1-s1', 'Let M be the midpoint of AB  →  AM = MB', 'Definition of midpoint'),
      step('th-l9-1-s2', 'PA = PB', 'Given'),
      step('th-l9-1-s3', 'PM = PM', 'Common side'),
      step('th-l9-1-s4', '△PMA ≅ △PMB', 'SSS postulate (Steps 1, 2, 3)'),
      step('th-l9-1-s5', '∠PMA = ∠PMB', 'Corresponding angles of congruent triangles'),
      step('th-l9-1-s6', '∠PMA = ∠PMB = 90°  →  PM ⊥ AB', '∠PMA + ∠PMB = 180°; equal supplementary angles = 90°'),
      step('th-l9-1-s7', 'P lies on the perpendicular bisector of AB', 'PM passes through midpoint M and is perpendicular to AB'),
    ],
  },

  {
    id: 'th-l9-2',
    classLevel: '9',
    chapterNo: 11,
    chapterName: 'Loci and Construction',
    title: 'Angle bisector locus',
    fullStatement:
      'Any point equidistant from two lines (sides of an angle) lies on the bisector of that angle.',
    given: 'Lines l₁ and l₂ meeting at vertex A. Point P equidistant from l₁ and l₂ (PD = PE, where D and E are the feet of perpendiculars).',
    toProve: 'P lies on the bisector of ∠DAE.',
    construction: 'Drop perpendiculars PD ⊥ l₁ and PE ⊥ l₂. Join PA.',
    marks: 8,
    hint: 'Use H.S ≅ H.S — both right triangles have equal hypotenuse PA and equal legs PD = PE.',
    steps: [
      step('th-l9-2-s1', '∠PDA = ∠PEA = 90°', 'PD ⊥ l₁ and PE ⊥ l₂ (construction)'),
      step('th-l9-2-s2', 'PA = PA', 'Common hypotenuse'),
      step('th-l9-2-s3', 'PD = PE', 'Given — P is equidistant from both lines'),
      step('th-l9-2-s4', '△PDA ≅ △PEA', 'H.S ≅ H.S (right angle, hypotenuse, side)'),
      step('th-l9-2-s5', '∠DAP = ∠EAP', 'Corresponding angles of congruent triangles'),
      step('th-l9-2-s6', 'P lies on the bisector of ∠DAE', 'AP bisects ∠DAE since ∠DAP = ∠EAP'),
    ],
  },
];

/** Get theorems filtered by class level */
export function theoremsForClass(classLevel: ClassLevel): Theorem[] {
  return THEOREMS.filter((t) => t.classLevel === classLevel);
}

/** Get a single theorem by id */
export function getTheorem(id: string): Theorem | undefined {
  return THEOREMS.find((t) => t.id === id);
}
