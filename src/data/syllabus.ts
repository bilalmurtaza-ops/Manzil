import type { ClassLevel, StudyGroup } from '../lib/types';

/**
 * Punjab (PCTB) matric syllabus dataset, aligned with the 2026 exam cycle:
 *  - Class 9  -> NEW national-curriculum textbooks (rolled out 2025-26)
 *  - Class 10 -> current PCTB textbooks and the 2026 pairing schemes
 *
 * `weight` (1-5) encodes relative board-exam weight per chapter, derived from
 * the official pairing schemes (MCQ counts + short/long question distribution).
 * `difficulty` (1-5) is a prep-effort estimate used by the plan engine.
 * `estMinutes` is the first-pass study time for an average student.
 */

export interface Chapter {
  id: string;
  no: number;
  name: string;
  weight: number;
  difficulty: number;
  estMinutes: number;
}

export interface Subject {
  id: string;
  name: string;
  urduName: string;
  /** key into subjectColor tokens */
  colorKey: string;
  /** which groups take this subject */
  groups: StudyGroup[] | 'all';
  /** theory paper structure summary shown to students + used in AI prompts */
  pattern: Record<ClassLevel, string | null>;
  chapters: Record<ClassLevel, Chapter[]>;
}

const ch = (
  prefix: string,
  no: number,
  name: string,
  weight: number,
  difficulty: number,
  estMinutes: number,
): Chapter => ({ id: `${prefix}-${no}`, no, name, weight, difficulty, estMinutes });

export const SUBJECTS: Subject[] = [
  {
    id: 'math',
    name: 'Mathematics',
    urduName: 'ریاضی',
    colorKey: 'math',
    groups: ['science-bio', 'science-cs'],
    pattern: {
      '9': 'Total 75 marks: 15 MCQs · short questions (attempt 6 of 9 per set, 36 marks) · long questions 24 marks.',
      '10': 'Total 75 marks: 15 MCQs · short questions (attempt 6 of 9 per set, 36 marks) · long questions (attempt 2 of 4 + compulsory theorem, 24 marks).',
    },
    chapters: {
      '9': [
        ch('m9', 1, 'Real Numbers', 4, 3, 180),
        ch('m9', 2, 'Logarithms', 4, 3, 180),
        ch('m9', 3, 'Sets and Functions', 4, 3, 200),
        ch('m9', 4, 'Factorization and Algebraic Manipulation', 5, 4, 240),
        ch('m9', 5, 'Linear Equations and Inequalities', 4, 3, 200),
        ch('m9', 6, 'Trigonometry', 4, 4, 220),
        ch('m9', 7, 'Coordinate Geometry', 3, 3, 180),
        ch('m9', 8, 'Logic', 2, 2, 120),
        ch('m9', 9, 'Similar Figures', 3, 3, 160),
        ch('m9', 10, 'Graphs of Functions', 3, 3, 160),
        ch('m9', 11, 'Loci and Construction', 2, 3, 140),
        ch('m9', 12, 'Information Handling', 3, 2, 140),
        ch('m9', 13, 'Probability', 3, 2, 140),
      ],
      '10': [
        ch('m10', 1, 'Quadratic Equations', 5, 3, 200),
        ch('m10', 2, 'Theory of Quadratic Equations', 3, 4, 200),
        ch('m10', 3, 'Variations', 4, 3, 180),
        ch('m10', 4, 'Partial Fractions', 3, 3, 150),
        ch('m10', 5, 'Sets and Functions', 4, 3, 180),
        ch('m10', 6, 'Basic Statistics', 3, 2, 160),
        ch('m10', 7, 'Introduction to Trigonometry', 4, 4, 220),
        ch('m10', 8, 'Projection of a Side of a Triangle', 2, 3, 120),
        ch('m10', 9, 'Chords of a Circle', 4, 3, 140),
        ch('m10', 10, 'Tangent to a Circle', 3, 3, 140),
        ch('m10', 11, 'Chords and Arcs', 3, 3, 130),
        ch('m10', 12, 'Angle in a Segment of a Circle', 4, 3, 130),
        ch('m10', 13, 'Practical Geometry – Circles', 3, 3, 150),
      ],
    },
  },
  {
    id: 'physics',
    name: 'Physics',
    urduName: 'فزکس',
    colorKey: 'physics',
    groups: ['science-bio', 'science-cs'],
    pattern: {
      '9': 'Theory 60 marks: 12 MCQs · short questions (attempt 5 of 8 per set, 30 marks) · 3 long questions from paired chapters (1–3, 4–6, 7–9), 18 marks. Practical 15 marks.',
      '10': 'Theory 60 marks: 12 MCQs · short questions (attempt 5 of 8 per set, 30 marks) · long questions pair chapters (10,13,16 · 11,14,17 · 12,15,18), 18 marks. Practical 15 marks.',
    },
    chapters: {
      '9': [
        ch('p9', 1, 'Physical Quantities and Measurements', 3, 2, 150),
        ch('p9', 2, 'Kinematics', 4, 4, 220),
        ch('p9', 3, 'Dynamics', 4, 4, 220),
        ch('p9', 4, 'Turning Effects of Forces', 4, 3, 180),
        ch('p9', 5, 'Work, Energy and Power', 3, 3, 170),
        ch('p9', 6, 'Mechanical Properties of Matter', 4, 3, 170),
        ch('p9', 7, 'Thermal Properties of Matter', 3, 3, 170),
        ch('p9', 8, 'Magnetism', 3, 3, 150),
        ch('p9', 9, 'Nature of Science', 2, 1, 90),
      ],
      '10': [
        ch('p10', 10, 'Simple Harmonic Motion and Waves', 4, 4, 200),
        ch('p10', 11, 'Sound', 4, 3, 170),
        ch('p10', 12, 'Geometrical Optics', 3, 4, 220),
        ch('p10', 13, 'Electrostatics', 4, 4, 200),
        ch('p10', 14, 'Current Electricity', 5, 4, 230),
        ch('p10', 15, 'Electromagnetism', 4, 4, 200),
        ch('p10', 16, 'Basic Electronics', 4, 3, 150),
        ch('p10', 17, 'Information and Communication Technology', 3, 2, 120),
        ch('p10', 18, 'Atomic and Nuclear Physics', 3, 3, 170),
      ],
    },
  },
  {
    id: 'chemistry',
    name: 'Chemistry',
    urduName: 'کیمسٹری',
    colorKey: 'chemistry',
    groups: ['science-bio', 'science-cs'],
    pattern: {
      '9': 'Theory 60 marks: 12 MCQs · short questions (attempt 5 of 8 per set, 30 marks) · 3 long questions: Q5 pairs Ch1+2, Q6 pairs Ch3+7, Q7 pairs Ch8+10, 18 marks (chapters 4–6, 9, 11–13 examined via MCQ/short only). Practical 15 marks.',
      '10': 'Theory 60 marks: 12 MCQs · short questions (attempt 5 of 8 per set, 30 marks) · long questions pair chapters (10,11 · 12,13 · 14,16), 18 marks. Practical 15 marks.',
    },
    chapters: {
      '9': [
        ch('c9', 1, 'States of Matter and Phase Changes', 4, 3, 180),
        ch('c9', 2, 'Atomic Structure', 4, 3, 180),
        ch('c9', 3, 'Chemical Bonding', 4, 4, 200),
        ch('c9', 4, 'Stoichiometry', 4, 4, 220),
        ch('c9', 5, 'Energetics', 3, 3, 160),
        ch('c9', 6, 'Equilibria', 3, 3, 160),
        ch('c9', 7, 'Acid Base Chemistry', 4, 3, 170),
        ch('c9', 8, 'Periodic Table and Periodicity', 4, 3, 170),
        ch('c9', 9, 'Group Properties and Elements', 3, 3, 160),
        ch('c9', 10, 'Environmental Chemistry', 3, 2, 130),
        ch('c9', 11, 'Hydrocarbons', 4, 3, 170),
        ch('c9', 12, 'Empirical Data Collection and Analysis', 1, 2, 90),
        ch('c9', 13, 'Laboratory and Practical Skills', 1, 2, 90),
      ],
      '10': [
        ch('c10', 9, 'Chemical Equilibrium', 3, 3, 160),
        ch('c10', 10, 'Acids, Bases and Salts', 4, 3, 180),
        ch('c10', 11, 'Organic Chemistry', 4, 4, 200),
        ch('c10', 12, 'Hydrocarbons', 4, 4, 190),
        ch('c10', 13, 'Biochemistry', 3, 3, 170),
        ch('c10', 14, 'Environmental Chemistry I — The Atmosphere', 4, 2, 140),
        ch('c10', 15, 'Environmental Chemistry II — Water', 4, 2, 140),
        ch('c10', 16, 'Chemical Industries', 5, 3, 170),
      ],
    },
  },
  {
    id: 'biology',
    name: 'Biology',
    urduName: 'بیالوجی',
    colorKey: 'biology',
    groups: ['science-bio'],
    pattern: {
      '9': 'Theory 60 marks: 12 MCQs · short questions (attempt 5 of 8 per set, 30 marks) · 3 long questions from paired chapters, 18 marks. Practical 15 marks.',
      '10': 'Theory 60 marks: 12 MCQs · short questions (attempt 5 of 8 per set, 30 marks) · long questions pair chapters (11,13 · 12,14 · 17,18), 18 marks. Practical 15 marks.',
    },
    chapters: {
      '9': [
        ch('b9', 1, 'Introduction to Biology', 3, 2, 140),
        ch('b9', 2, 'Biodiversity', 3, 3, 160),
        ch('b9', 3, 'The Cell', 4, 3, 180),
        ch('b9', 4, 'Cell Cycle', 4, 3, 170),
        ch('b9', 5, 'Tissues, Organs and Organ Systems', 3, 3, 170),
        ch('b9', 6, 'Molecular Biology', 4, 4, 190),
        ch('b9', 7, 'Enzymes', 3, 3, 150),
        ch('b9', 8, 'Bioenergetics', 4, 4, 190),
        ch('b9', 9, 'Plant Physiology', 4, 3, 180),
        ch('b9', 10, 'Reproduction in Plants', 4, 3, 160),
        ch('b9', 11, 'Biostatistics', 2, 2, 110),
      ],
      '10': [
        ch('b10', 10, 'Gaseous Exchange', 3, 3, 150),
        ch('b10', 11, 'Homeostasis', 4, 4, 190),
        ch('b10', 12, 'Coordination and Control', 5, 4, 220),
        ch('b10', 13, 'Support and Movement', 5, 3, 180),
        ch('b10', 14, 'Reproduction', 4, 3, 190),
        ch('b10', 15, 'Inheritance', 3, 4, 180),
        ch('b10', 16, 'Man and His Environment', 4, 3, 160),
        ch('b10', 17, 'Biotechnology', 3, 3, 150),
        ch('b10', 18, 'Pharmacology', 3, 2, 120),
      ],
    },
  },
  {
    id: 'computer',
    name: 'Computer Science',
    urduName: 'کمپیوٹر سائنس',
    colorKey: 'computer',
    groups: ['science-cs'],
    pattern: {
      '9': 'Theory 50 marks: 10 MCQs · short questions (attempt 4 of 6 per set, 24 marks) · long questions 16 marks. Practical 50 marks.',
      '10': 'Theory 45 marks: 10 MCQs (2 per chapter) · short questions (attempt 5 of 8, 24 marks) · long questions from chapters 1–3 (attempt 2 of 3, 16 marks). Practical 30 marks.',
    },
    chapters: {
      '9': [
        ch('cs9', 1, 'Introduction to Systems', 4, 2, 140),
        ch('cs9', 2, 'Number Systems', 4, 3, 170),
        ch('cs9', 3, 'Digital Systems and Logic Design', 3, 3, 170),
        ch('cs9', 4, 'System Troubleshooting', 3, 2, 120),
        ch('cs9', 5, 'Software Systems', 3, 2, 130),
        ch('cs9', 6, 'Introduction to Computer Networks', 4, 3, 160),
        ch('cs9', 7, 'Computational Thinking', 3, 3, 150),
        ch('cs9', 8, 'Web Development with HTML, CSS and JavaScript', 3, 3, 180),
        ch('cs9', 9, 'Data Science and Data Gathering', 4, 3, 150),
        ch('cs9', 10, 'Emerging Technologies in Computer Science', 2, 2, 110),
        ch('cs9', 11, 'Ethical, Social and Legal Concerns', 2, 1, 90),
        ch('cs9', 12, 'Entrepreneurship in the Digital Age', 3, 2, 110),
      ],
      '10': [
        ch('cs10', 1, 'Introduction to Programming', 5, 3, 180),
        ch('cs10', 2, 'User Interaction', 5, 3, 170),
        ch('cs10', 3, 'Conditional Control Structures', 5, 3, 180),
        ch('cs10', 4, 'Data and Repetition Control Structures', 4, 4, 200),
        ch('cs10', 5, 'Functions', 3, 3, 150),
      ],
    },
  },
  {
    id: 'english',
    name: 'English',
    urduName: 'انگریزی',
    colorKey: 'english',
    groups: 'all',
    pattern: {
      '9': 'Total 75 marks: objective 19 (MCQs on prose, poems, grammar) · subjective 56 (comprehension, translation, summary/poetry, letter/story, active-passive).',
      '10': 'Total 75 marks: objective 19 · subjective 56 (comprehension, translation, essay/paragraph, direct-indirect, pair of words).',
    },
    chapters: {
      '9': [
        ch('e9', 1, 'The Saviour of Mankind', 4, 2, 120),
        ch('e9', 2, 'Patriotism', 3, 2, 110),
        ch('e9', 3, 'Daffodils (Poem)', 4, 2, 100),
        ch('e9', 4, 'Hazrat Asma (R.A)', 4, 2, 120),
        ch('e9', 5, 'Women Empowerment through Entrepreneurship', 2, 2, 110),
        ch('e9', 6, 'The Value of Time', 3, 2, 110),
        ch('e9', 7, 'If (Poem)', 4, 2, 100),
        ch('e9', 8, "Globalisation's Impact on Culture and Economy", 2, 3, 120),
        ch('e9', 9, 'Quality Education: A Key to Success', 3, 2, 110),
        ch('e9', 10, 'The Silent Predator and the Majestic Prey — Snow Leopard and Markhor', 2, 2, 110),
        ch('e9', 11, 'The Dear Departed (Play)', 4, 3, 130),
        ch('e9', 12, 'Grammar and Composition (letters, stories, active-passive)', 5, 3, 240),
      ],
      '10': [
        ch('e10', 1, 'Hazrat Muhammad ﷺ — an Embodiment of Justice', 4, 2, 120),
        ch('e10', 2, 'Chinese New Year', 3, 2, 110),
        ch('e10', 3, 'Try Again (Poem)', 4, 2, 100),
        ch('e10', 4, 'First Aid', 3, 2, 110),
        ch('e10', 5, 'The Rain (Poem)', 4, 2, 100),
        ch('e10', 6, 'Television vs. Newspapers', 3, 2, 110),
        ch('e10', 7, 'Little by Little One Walks Far', 3, 2, 110),
        ch('e10', 8, 'Peace (Poem)', 4, 2, 100),
        ch('e10', 9, 'Selecting the Right Career', 3, 2, 110),
        ch('e10', 10, 'A World Without Books', 3, 2, 110),
        ch('e10', 11, 'Great Expectations', 3, 3, 120),
        ch('e10', 12, 'Population Growth and World Food Supplies', 3, 2, 110),
        ch('e10', 13, 'Faithfulness', 3, 2, 110),
        ch('e10', 14, 'Grammar and Composition (essay, direct-indirect, pairs of words)', 5, 3, 240),
      ],
    },
  },
  {
    id: 'urdu',
    name: 'Urdu',
    urduName: 'اردو',
    colorKey: 'urdu',
    groups: 'all',
    pattern: {
      '9': 'Total 75 marks: objective 15 (prose, poetry, ghazal, grammar MCQs) · subjective 60 (تشریح نثر و نظم، خلاصہ، مضمون، خط، درخواست، جملوں کی درستی).',
      '10': 'Total 75 marks: objective 15 · subjective 60 (تشریح، خلاصہ، مضمون نویسی، خط، روزمرہ و محاورات).',
    },
    chapters: {
      '9': [
        ch('u9', 1, 'حمد', 2, 2, 70),
        ch('u9', 2, 'نعت', 2, 2, 70),
        ch('u9', 3, 'اخلاق حسنہ', 2, 2, 70),
        ch('u9', 4, 'اپنی مدد آپ', 2, 2, 70),
        ch('u9', 5, 'کلیم اور مرزا ظاہر دار بیگ', 2, 2, 70),
        ch('u9', 6, 'نام دیو مالی', 2, 2, 70),
        ch('u9', 7, 'آرام و سکون', 2, 2, 70),
        ch('u9', 8, 'کتبہ', 2, 2, 70),
        ch('u9', 9, 'ابتدائی حساب', 2, 2, 70),
        ch('u9', 10, 'لڑی میں پروئے ہوئے منظر', 2, 2, 70),
        ch('u9', 11, 'بھیڑیا', 2, 2, 70),
        ch('u9', 12, 'محنت کی برکات', 2, 2, 70),
        ch('u9', 13, 'جاوید کے نام — علامہ اقبال', 3, 2, 70),
        ch('u9', 14, 'پیام لطیف', 2, 2, 70),
        ch('u9', 15, 'کرکٹ اور مشاعرہ', 2, 2, 70),
        ch('u9', 16, 'غزل: فقیرانہ آئے صدا کر چلے — میر تقی میر', 3, 2, 70),
        ch('u9', 17, 'غزل: سن تو سہی جہاں میں ہے تیرا فسانہ کیا — خواجہ حیدر علی آتش', 3, 2, 70),
        ch('u9', 18, 'غم ہے یا خوشی ہے تو', 2, 2, 70),
        ch('u9', 19, 'غزل: کاش طوفاں میں سفینے کو اتارا ہوتا — پروین فنا سید', 3, 2, 70),
      ],
      '10': [
        ch('u10', 1, 'حمد', 2, 2, 70),
        ch('u10', 2, 'نعت', 2, 2, 70),
        ch('u10', 3, 'اخلاق نبویؐ', 2, 2, 70),
        ch('u10', 4, 'سر سید کا بچپن', 2, 2, 70),
        ch('u10', 5, 'محسن محلہ', 2, 2, 70),
        ch('u10', 6, 'کفارہ', 2, 2, 70),
        ch('u10', 7, 'صبح جو کل میری آنکھ کھلی', 2, 2, 70),
        ch('u10', 8, 'دوستی کا پھل', 2, 2, 70),
        ch('u10', 9, 'میرا گاؤں', 2, 2, 70),
        ch('u10', 10, 'بابل کے کھنڈرات', 2, 2, 70),
        ch('u10', 11, 'اولڈ ایج ہوم', 2, 2, 70),
        ch('u10', 12, 'کچھ ذرائع تعلیم کے باب میں', 2, 2, 70),
        ch('u10', 13, 'آدمی نامہ — نظیر اکبر آبادی', 3, 2, 70),
        ch('u10', 14, 'نمود صبح', 2, 2, 70),
        ch('u10', 15, 'خطاب بہ جوانانِ اسلام', 2, 2, 70),
        ch('u10', 16, 'غزل: بازیچہ اطفال ہے دنیا مرے آگے — مرزا اسد اللہ خان غالب', 3, 2, 70),
        ch('u10', 17, 'غزل: اثر اس کو ذرا نہیں ہوتا', 2, 2, 70),
        ch('u10', 18, 'غزل: ہے مشقِ سخن جاری، چکی کی مشقت بھی', 2, 2, 70),
        ch('u10', 19, 'غزل: یوں کہنے کو پیرہنِ اظہار بہت ہے', 2, 2, 70),
      ],
    },
  },
  {
    id: 'islamiat',
    name: 'Islamiat',
    urduName: 'اسلامیات',
    colorKey: 'islamiat',
    groups: 'all',
    pattern: {
      '9': 'Compulsory in class 9 only — single 100-mark paper (2026-cycle Punjab scheme; syllabus now combines content previously split across classes 9 and 10). Objective + subjective paper covering Quranic passages, hadith, aqaid, ibadat and seerah.',
      '10': null,
    },
    chapters: {
      '9': [
        ch('is9', 1, 'قرآنِ مجید اور حدیثِ نبویؐ', 4, 3, 160),
        ch('is9', 2, 'ایمانیات اور عبادات', 4, 3, 160),
        ch('is9', 3, 'سیرت النبیؐ', 4, 3, 160),
        ch('is9', 4, 'اخلاق و آداب', 4, 3, 160),
        ch('is9', 5, 'حسنِ معاملات اور معاشرت', 4, 3, 160),
        ch('is9', 6, 'ہدایت کے سرچشمے اور مشاہیرِ اسلام', 4, 3, 160),
        ch('is9', 7, 'اسلامی تعلیمات اور عصرِ حاضر کے تقاضے', 4, 3, 160),
      ],
      '10': [],
    },
  },
  {
    id: 'pakstudies',
    name: 'Pakistan Studies',
    urduName: 'مطالعہ پاکستان',
    colorKey: 'pakstudies',
    groups: 'all',
    pattern: {
      '9': null,
      '10': 'Compulsory in class 10 only — single 100-mark paper (2026-cycle Punjab scheme). Objective + subjective; short questions chapter-wise, long questions from history/geography chapters (1–4).',
    },
    chapters: {
      '9': [],
      '10': [
        ch('ps10', 1, 'Ideology of Pakistan — نظریہ پاکستان', 5, 3, 160),
        ch('ps10', 2, 'Making of Pakistan — قیام پاکستان', 4, 3, 160),
        ch('ps10', 3, 'Land and Environment — زمین اور ماحول', 4, 3, 150),
        ch('ps10', 4, 'History of Pakistan I — تاریخ پاکستان اول', 4, 3, 160),
        ch('ps10', 5, 'History of Pakistan II — تاریخ پاکستان دوم', 3, 3, 150),
        ch('ps10', 6, 'Pakistan and World Affairs — پاکستان اور عالمی امور', 3, 3, 140),
        ch('ps10', 7, 'Economic Development — معاشی ترقی', 3, 2, 130),
        ch('ps10', 8, 'Population, Society and Culture — آبادی، معاشرہ اور ثقافت', 3, 2, 130),
      ],
    },
  },
  {
    id: 'tarjuma',
    name: 'Tarjuma-tul-Quran',
    urduName: 'ترجمۃ القرآن',
    colorKey: 'islamiat',
    groups: 'all',
    pattern: {
      '9': 'Translation of prescribed surahs/passages with objective and subjective parts.',
      '10': 'Translation of prescribed surahs/passages with objective and subjective parts.',
    },
    chapters: {
      '9': [
        ch('tq9', 1, 'Surah Maryam', 3, 2, 110),
        ch('tq9', 2, 'Surah Taha', 3, 2, 110),
        ch('tq9', 3, 'Surah Al-Anbiya', 3, 2, 110),
        ch('tq9', 4, 'Surah Al-Hajj', 3, 2, 110),
        ch('tq9', 5, 'Surah Al-Furqan', 3, 2, 110),
        ch('tq9', 6, "Surah Ash-Shu'ara", 3, 2, 110),
        ch('tq9', 7, 'Surah An-Naml', 3, 2, 110),
        ch('tq9', 8, 'Surah Al-Qasas', 3, 2, 110),
        ch('tq9', 9, 'Surah Al-Ankabut', 3, 2, 110),
        ch('tq9', 10, 'Surah Ar-Rum', 3, 2, 110),
        ch('tq9', 11, 'Surah Luqman', 3, 2, 110),
        ch('tq9', 12, 'Surah As-Sajdah', 3, 2, 110),
        ch('tq9', 13, 'Surah Saba', 3, 2, 110),
        ch('tq9', 14, 'Surah Fatir', 3, 2, 110),
        ch('tq9', 15, 'Surah Yasin', 3, 2, 110),
        ch('tq9', 16, 'Surah As-Saffat', 3, 2, 110),
        ch('tq9', 17, 'Surah Sad', 3, 2, 110),
        ch('tq9', 18, 'Surah Al-Ahqaf', 3, 2, 110),
      ],
      '10': [
        ch('tq10', 1, "Surah Al-An'am", 3, 2, 110),
        ch('tq10', 2, "Surah Al-A'raf", 3, 2, 110),
        ch('tq10', 3, 'Surah Yunus', 3, 2, 110),
        ch('tq10', 4, 'Surah Hud', 3, 2, 110),
        ch('tq10', 5, "Surah Ar-Ra'd", 3, 2, 110),
        ch('tq10', 6, 'Surah Ibrahim', 3, 2, 110),
        ch('tq10', 7, 'Surah Al-Hijr', 3, 2, 110),
        ch('tq10', 8, 'Surah An-Nahl', 3, 2, 110),
        ch('tq10', 9, 'Surah Al-Isra (Bani Israel)', 3, 2, 110),
        ch('tq10', 10, 'Surah Al-Kahf', 3, 2, 110),
        ch('tq10', 11, "Surah Al-Mu'minun", 3, 2, 110),
        ch('tq10', 12, 'Surah Az-Zumar', 3, 2, 110),
        ch('tq10', 13, "Surah Ghafir (Al-Mu'min)", 3, 2, 110),
        ch('tq10', 14, 'Surah Fussilat (Ha-Mim As-Sajdah)', 3, 2, 110),
        ch('tq10', 15, 'Surah Ash-Shura', 3, 2, 110),
      ],
    },
  },
  {
    id: 'genmath',
    name: 'General Mathematics',
    urduName: 'جنرل ریاضی',
    colorKey: 'math',
    groups: ['arts'],
    pattern: {
      '9': 'Total 75 marks: MCQs + short questions + long questions, chapter-wise per pairing scheme.',
      '10': 'Total 75 marks: MCQs + short questions + long questions, chapter-wise per pairing scheme.',
    },
    chapters: {
      '9': [
        ch('gm9', 1, 'Percentage, Ratio and Proportion', 4, 3, 170),
        ch('gm9', 2, 'Zakat, Ushr and Inheritance', 4, 2, 150),
        ch('gm9', 3, 'Business Mathematics', 4, 3, 170),
        ch('gm9', 4, 'Financial Mathematics', 4, 3, 170),
        ch('gm9', 5, 'Consumer Mathematics', 3, 2, 140),
        ch('gm9', 6, 'Exponents and Logarithms', 3, 3, 160),
        ch('gm9', 7, 'Arithmetic and Geometric Sequences', 3, 3, 150),
        ch('gm9', 8, 'Sets and Functions', 3, 2, 130),
        ch('gm9', 9, 'Linear Graphs', 3, 2, 130),
        ch('gm9', 10, 'Basic Statistics', 3, 2, 140),
      ],
      '10': [
        ch('gm10', 1, 'Algebraic Formulas and Applications', 4, 3, 170),
        ch('gm10', 2, 'Factorization', 4, 3, 170),
        ch('gm10', 3, 'Algebraic Manipulation', 4, 3, 160),
        ch('gm10', 4, 'Linear Equations and Inequalities', 4, 3, 160),
        ch('gm10', 5, 'Quadratic Equations', 4, 3, 160),
        ch('gm10', 6, 'Matrices and Determinants', 3, 3, 150),
        ch('gm10', 7, 'Fundamentals of Geometry', 3, 2, 140),
        ch('gm10', 8, 'Practical Geometry', 3, 2, 140),
        ch('gm10', 9, 'Areas and Volumes', 3, 3, 150),
        ch('gm10', 10, 'Introduction to Coordinate Geometry', 3, 2, 130),
      ],
    },
  },
  {
    id: 'genscience',
    name: 'General Science',
    urduName: 'جنرل سائنس',
    colorKey: 'biology',
    groups: ['arts'],
    pattern: {
      '9': 'Total 75 marks: MCQs + short questions + long questions, chapter-wise per pairing scheme.',
      '10': 'Total 75 marks: MCQs + short questions + long questions, chapter-wise per pairing scheme.',
    },
    chapters: {
      '9': [
        ch('gs9', 1, 'Introduction and Role of Science', 3, 2, 130),
        ch('gs9', 2, 'Our Life and Chemistry', 4, 3, 160),
        ch('gs9', 3, 'Biochemistry and Biotechnology', 4, 3, 160),
        ch('gs9', 4, 'Human Health', 4, 2, 150),
        ch('gs9', 5, 'Diseases — Causes and Prevention', 4, 3, 160),
        ch('gs9', 6, 'Environment and Natural Resources', 3, 2, 140),
      ],
      '10': [
        ch('gs10', 7, 'Energy', 4, 3, 160),
        ch('gs10', 8, 'Current Electricity', 4, 3, 170),
        ch('gs10', 9, 'Basic Electronics', 4, 3, 150),
        ch('gs10', 10, 'Science and Technology', 3, 2, 140),
        ch('gs10', 11, 'Space and Nuclear Programme of Pakistan', 3, 2, 140),
      ],
    },
  },
];

/** Subjects a student takes, given class + group. Subjects with no chapters for that class are dropped. */
export function subjectsForProfile(classLevel: ClassLevel, group: StudyGroup): Subject[] {
  return SUBJECTS.filter(
    (s) =>
      (s.groups === 'all' || s.groups.includes(group)) &&
      s.chapters[classLevel].length > 0,
  );
}

export function getSubject(id: string): Subject | undefined {
  return SUBJECTS.find((s) => s.id === id);
}

export function getChapter(subjectId: string, chapterId: string): Chapter | undefined {
  const s = getSubject(subjectId);
  if (!s) return undefined;
  return [...s.chapters['9'], ...s.chapters['10']].find((c) => c.id === chapterId);
}
