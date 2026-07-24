import Svg, { Circle, Path } from 'react-native-svg';

interface IconProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

/** Sun-over-line: today */
export function TodayIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="11" r="4.2" stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M12 3.5v1.8M18 5.8l-1.3 1.3M20.5 11h-1.8M5.3 7.1L4 5.8M5.3 11H3.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path d="M4 19h16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

/** Winding path with milestone dot: the plan / manzil */
export function PlanIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 20c6 0 5-6.5 0-6.5S-1 7 5 7h8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        transform="translate(3 0) scale(0.82)"
      />
      <Circle cx="17.5" cy="5.8" r="2.6" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M17.5 8.4v2.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

/** Pencil striking a tick: practice */
export function PracticeIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path d="M12.5 6.5l5 5" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

/** Speech bubble with sparkle: Ustaad AI */
export function UstaadIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H12l-4.5 4v-4h-1A2.5 2.5 0 014 13.5v-7z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path
        d="M12 7.2l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9.9-2z"
        fill={color}
      />
    </Svg>
  );
}

/** Ascending bars: progress */
export function ProgressIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 20v-5M10.5 20V10M16 20v-7.5M21 20V6"
        stroke={color}
        strokeWidth={strokeWidth + 0.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Small flame for streaks */
export function FlameIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5c1 3-0.5 4.5-1.8 6C8.6 10.3 7 12 7 15a5 5 0 0010 0c0-2.2-1-3.8-2-5-0.4 1-1 1.6-1.8 2-0.2-3.2-0.6-6.5-1.2-9.5z"
        fill={color}
      />
    </Svg>
  );
}

/** Chevron for list rows */
export function ChevronIcon({ size = 16, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5.5l7 6.5-7 6.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Camera for snap-to-study */
export function CameraIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 8.5A2 2 0 015.5 6.5h2l1.6-2h5.8l1.6 2h2a2 2 0 012 2v9a2 2 0 01-2 2h-13a2 2 0 01-2-2v-9z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="13" r="3.4" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

/** Five-point star: motivation / inspiration */
export function StarIcon({ size = 20, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5L14.2 8.9L21 9.1L15.6 13.2L17.6 19.7L12 15.8L6.4 19.7L8.4 13.2L3 9.1L9.8 8.9Z"
        fill={color}
      />
    </Svg>
  );
}

/** Microphone: voice input */
export function MicIcon({ size = 22, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5a3 3 0 013 3v5.5a3 3 0 01-6 0V6.5a3 3 0 013-3z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path
        d="M6.5 11v.8a5.5 5.5 0 0011 0V11M12 17.3v3.2M9 20.5h6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Filled rounded square: stop recording */
export function StopIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 8.5A3.5 3.5 0 018.5 5h7A3.5 3.5 0 0119 8.5v7a3.5 3.5 0 01-3.5 3.5h-7A3.5 3.5 0 015 15.5v-7z" fill={color} />
    </Svg>
  );
}

/** Leaf with a center vein: calm / breathing */
export function LeafIcon({ size = 20, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 19C5 10 11 4 19 4c0 8-6 14-14 14H5z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path d="M5.5 18.5C9 14.5 13 10.5 18 5.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

/** Tick mark */
export function CheckIcon({ size = 16, color, strokeWidth = 2.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12.5l5 5 10-11"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
