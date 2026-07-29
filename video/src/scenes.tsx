import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { color, subjectColor, SG, NNU, s } from './theme';
import { Count, Line, Rule, Urdu, local, useEnter } from './ui';

const PAD = 120;

const dark: React.CSSProperties = {
  backgroundColor: color.inkWash,
  padding: PAD,
  justifyContent: 'center',
};
const paper: React.CSSProperties = {
  backgroundColor: color.paper,
  padding: PAD,
  justifyContent: 'center',
};

/* ------------------------------------------------------------------ 1. PROBLEM */
/**
 * Opens on the problem, not the product. A judge who has watched twenty demo
 * videos has never once been shown the actual gap first — leading with it buys
 * the attention the rest of the film spends.
 */
export const Problem: React.FC = () => (
  <AbsoluteFill style={dark}>
    <Line from={s(0.3)} size={56} col="rgba(242,238,227,0.72)" mb={18}>
      Every year, a matric student in Pakistan
    </Line>
    <Line from={s(1.1)} size={56} col="rgba(242,238,227,0.72)" mb={18}>
      is handed a syllabus.
    </Line>
    <Line from={s(2.6)} size={56} col="rgba(242,238,227,0.72)" mb={44}>
      And a pairing scheme.
    </Line>
    <Line from={s(4.6)} size={74} col={color.gold}>
      Nobody hands them a plan.
    </Line>
  </AbsoluteFill>
);

/* --------------------------------------------------------------------- 2. LOGO */
export const Logo: React.FC = () => (
  <AbsoluteFill style={{ ...dark, alignItems: 'center', textAlign: 'center' }}>
    <Urdu from={s(0.2)} size={92}>
      منزل
    </Urdu>
    <Line from={s(0.7)} size={130} ls={-5}>
      Manzil
    </Line>
    <div style={{ marginTop: 28, marginBottom: 30 }}>
      <Rule from={s(1.3)} w={220} />
    </div>
    <Line from={s(1.7)} size={34} weight={400} col="rgba(242,238,227,0.7)" ls={-0.3}>
      A study plan built from the board&rsquo;s own marks.
    </Line>
  </AbsoluteFill>
);

/* --------------------------------------------------------------------- 3. DATA */
const CHAPTERS: { name: string; subj: keyof typeof subjectColor; w: number }[] = [
  { name: 'Chemical Equilibrium', subj: 'chemistry', w: 5 },
  { name: 'Gravitation', subj: 'physics', w: 4 },
  { name: 'Quadratic Equations', subj: 'math', w: 5 },
  { name: 'Cell Cycle', subj: 'biology', w: 4 },
  { name: 'Electrostatics', subj: 'physics', w: 5 },
  { name: 'Coordinate Geometry', subj: 'math', w: 3 },
  { name: 'Biotechnology', subj: 'biology', w: 3 },
  { name: 'Organic Chemistry', subj: 'chemistry', w: 4 },
];

/**
 * The moat, made visible. Weight bars are the whole argument: this is data the
 * board publishes and nobody else has bothered to encode chapter by chapter.
 */
export const Data: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={paper}>
      <Line from={s(0.2)} size={46} col={color.ink} mb={10} ls={-1}>
        245 chapters.
      </Line>
      <Line from={s(0.8)} size={46} col={color.greenMid} mb={44} ls={-1}>
        Each weighted by how the board actually awards marks.
      </Line>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
        {CHAPTERS.map((c, i) => {
          const from = s(1.6) + i * 6;
          const p = spring({ frame: local(frame, from), fps, config: { damping: 200 } });
          const sc = subjectColor[c.subj];
          // Gold is reserved for weight 5 ONLY. Flagging everything >=4 turned
          // six of eight rows gold, which buried the subject colours and made
          // the callout meaningless — a highlight that highlights most things
          // highlights nothing.
          const heavy = c.w === 5;
          return (
            <div
              key={c.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                opacity: interpolate(p, [0, 1], [0, 1]),
                transform: `translateX(${interpolate(p, [0, 1], [-30, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 470,
                  fontFamily: SG,
                  fontSize: 30,
                  fontWeight: 500,
                  color: color.ink,
                }}
              >
                {c.name}
              </div>
              {/* weight bar — the board's own marks distribution, made literal */}
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = n <= c.w;
                  const fillP = spring({
                    frame: local(frame, from + 4 + n * 2),
                    fps,
                    config: { damping: 200 },
                  });
                  return (
                    <div
                      key={n}
                      style={{
                        width: 58,
                        height: 30,
                        borderRadius: 7,
                        background: on ? (heavy ? color.gold : sc.main) : color.line,
                        transform: `scaleX(${on ? interpolate(fillP, [0, 1], [0, 1]) : 1})`,
                        transformOrigin: 'left center',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ width: 210 }}>
                {heavy && (
                  <div
                    style={{
                      fontFamily: SG,
                      fontSize: 21,
                      fontWeight: 700,
                      color: color.goldDeep,
                      letterSpacing: 1.2,
                      opacity: interpolate(local(frame, from + 16), [0, 8], [0, 1], {
                        extrapolateRight: 'clamp',
                      }),
                    }}
                  >
                    TOP MARKS
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------- 4. ENGINE */
const SUBJ_ORDER: (keyof typeof subjectColor)[] = [
  'math', 'physics', 'chemistry', 'biology', 'english', 'urdu', 'islamiat', 'pakstudies',
];

/**
 * The calendar filling itself is the product's core promise in one image:
 * you did not build this schedule, and it covers every day.
 */
export const Engine: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const COLS = 14;
  const ROWS = 5;
  return (
    <AbsoluteFill style={paper}>
      <Line from={s(0.2)} size={46} col={color.ink} mb={10} ls={-1}>
        A deterministic engine turns that into a day-by-day plan.
      </Line>
      <Line from={s(0.9)} size={30} weight={400} col={color.inkSoft} mb={40} ls={-0.2}>
        Study pass &rarr; revision cycles &rarr; past-paper drills. No AI in the calendar.
      </Line>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: ROWS }).map((_, r) => (
          <div key={r} style={{ display: 'flex', gap: 10 }}>
            {Array.from({ length: COLS }).map((__, c) => {
              const idx = r * COLS + c;
              const from = s(1.5) + idx * 1.1;
              const p = spring({
                frame: local(frame, from),
                fps,
                config: { damping: 200, mass: 0.5 },
              });
              // Deterministic pseudo-variation: same every render, like the engine.
              const blocks = 1 + ((idx * 7) % 3);
              return (
                <div
                  key={c}
                  style={{
                    width: 78,
                    height: 96,
                    borderRadius: 10,
                    background: color.card,
                    border: `1px solid ${color.line}`,
                    padding: 7,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    opacity: interpolate(p, [0, 1], [0, 1]),
                    transform: `scale(${interpolate(p, [0, 1], [0.85, 1])})`,
                  }}
                >
                  {/*
                    Blocks FILL the card exactly rather than floating at the top.
                    That is not cosmetic: "sessions tile the day with no dead
                    gap" is one of the plan engine's asserted invariants, so the
                    visual should demonstrate it, not contradict it.
                  */}
                  {Array.from({ length: blocks }).map((___, b) => (
                    <div
                      key={b}
                      style={{
                        flex: 1,
                        borderRadius: 5,
                        background: subjectColor[SUBJ_ORDER[(idx + b * 2) % SUBJ_ORDER.length]].main,
                        opacity: interpolate(
                          local(frame, from + 3 + b * 2),
                          [0, 6],
                          [0, 0.92],
                          { extrapolateRight: 'clamp' },
                        ),
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------------------- 5. AI */
const Card: React.FC<{
  from: number;
  title: string;
  urdu?: string;
  children: React.ReactNode;
}> = ({ from, title, urdu, children }) => {
  const e = useEnter(from, 50);
  return (
    <div
      style={{
        ...e,
        flex: 1,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 22,
        padding: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontFamily: SG, fontSize: 27, fontWeight: 700, color: color.ink }}>
          {title}
        </div>
        {urdu && (
          <div style={{ fontFamily: NNU, fontSize: 20, color: color.greenMid, marginLeft: 'auto' }}>
            {urdu}
          </div>
        )}
      </div>
      {children}
    </div>
  );
};

const Bubble: React.FC<{ mine?: boolean; children: React.ReactNode }> = ({ mine, children }) => (
  <div
    style={{
      alignSelf: mine ? 'flex-end' : 'flex-start',
      background: mine ? color.green : color.greenSoft,
      color: mine ? color.paperOnDark : color.ink,
      fontFamily: SG,
      fontSize: 19,
      lineHeight: 1.4,
      padding: '12px 16px',
      borderRadius: 14,
      maxWidth: '86%',
    }}
  >
    {children}
  </div>
);

export const AI: React.FC = () => (
  <AbsoluteFill style={paper}>
    <Line from={s(0.2)} size={46} col={color.ink} mb={10} ls={-1}>
      Then AI does what AI is genuinely good at.
    </Line>
    <Line from={s(0.9)} size={30} weight={400} col={color.inkSoft} mb={40} ls={-0.2}>
      Every request carries Pakistan, PCTB and the student&rsquo;s own board with it.
    </Line>

    <div style={{ display: 'flex', gap: 24, alignItems: 'stretch' }}>
      <Card from={s(1.5)} title="Ustaad" urdu="استاد">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Bubble mine>Sir, photosynthesis samajh nahi aaya</Bubble>
          <Bubble>
            Chalo asaan karte hain — paudhay apna khana khud banate hain&hellip;
          </Bubble>
        </div>
      </Card>

      <Card from={s(2.2)} title="AI Examiner" urdu="امتحان">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontFamily: SG, fontSize: 64, fontWeight: 700, color: color.green }}>
            7
          </div>
          <div style={{ fontFamily: SG, fontSize: 30, fontWeight: 500, color: color.inkFaint }}>
            / 8
          </div>
        </div>
        <div style={{ fontFamily: SG, fontSize: 19, color: color.inkSoft, lineHeight: 1.45 }}>
          Diagram labelled correctly. Add the balanced equation for the last mark.
        </div>
      </Card>

      <Card from={s(2.9)} title="Focus Guard" urdu="توجہ">
        <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 74 }}>
          {[38, 56, 70, 62, 74, 48, 66, 72, 58, 68, 74, 44].map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: h,
                borderRadius: 4,
                background: h > 60 ? color.greenMid : color.line,
              }}
            />
          ))}
        </div>
        <div style={{ fontFamily: SG, fontSize: 19, color: color.inkSoft, lineHeight: 1.45 }}>
          Timer pauses when you walk away. 25 minutes means 25 minutes.
        </div>
      </Card>
    </div>
  </AbsoluteFill>
);

/* -------------------------------------------------------------------- 6. PROOF */
const Stat: React.FC<{ from: number; n: number; suffix?: string; label: string }> = ({
  from,
  n,
  suffix = '',
  label,
}) => {
  const e = useEnter(from, 30);
  return (
    <div style={{ ...e, flex: 1 }}>
      <div style={{ fontFamily: SG, fontSize: 96, fontWeight: 700, color: color.gold, letterSpacing: -3 }}>
        <Count to={n} from={from} />
        {suffix}
      </div>
      <div
        style={{
          fontFamily: SG,
          fontSize: 23,
          color: 'rgba(242,238,227,0.66)',
          lineHeight: 1.4,
          marginTop: 8,
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const Proof: React.FC = () => (
  <AbsoluteFill style={dark}>
    <Line from={s(0.2)} size={46} mb={54} ls={-1}>
      Built to be trusted with someone&rsquo;s year.
    </Line>
    <div style={{ display: 'flex', gap: 40 }}>
      <Stat from={s(0.9)} n={989} label="automated tests guarding the study engine" />
      <Stat from={s(1.4)} n={245} label="chapters encoded with real board weights" />
      <Stat from={s(1.9)} n={0} label="accounts or internet needed to study" />
    </div>
  </AbsoluteFill>
);

/* -------------------------------------------------------------------- 7. CLOSE */
export const Close: React.FC = () => (
  <AbsoluteFill style={{ ...dark, alignItems: 'center', textAlign: 'center' }}>
    <Urdu from={s(0.1)} size={80}>
      منزل
    </Urdu>
    <Line from={s(0.5)} size={116} ls={-4.5}>
      Manzil
    </Line>
    <div style={{ marginTop: 26, marginBottom: 28 }}>
      <Rule from={s(1.0)} w={200} />
    </div>
    <Line from={s(1.3)} size={32} weight={400} col="rgba(242,238,227,0.7)" ls={-0.2}>
      The destination — not the app.
    </Line>
    <div style={{ marginTop: 46 }}>
      <Urdu from={s(2.0)} size={34} col="rgba(242,238,227,0.5)">
        خودی کو کر بلند اتنا کہ ہر تقدیر سے پہلے
      </Urdu>
    </div>
  </AbsoluteFill>
);
