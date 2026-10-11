import Svg, { Circle, Path } from 'react-native-svg';

export type QuestIconName =
  | 'camera'
  | 'upload'
  | 'calendar'
  | 'clock'
  | 'people'
  | 'sparkle'
  | 'close'
  | 'warning'
  | 'chevronLeft'
  | 'chevronRight';

type QuestIconProps = {
  name: QuestIconName;
  color: string;
  size?: number;
};

export default function QuestIcon({ name, color, size = 22 }: QuestIconProps) {
  const line = {
    fill: 'none',
    stroke: color,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {name === 'camera' ? (
        <>
          <Path {...line} d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
          <Circle {...line} cx="12" cy="13" r="3.5" />
        </>
      ) : null}
      {name === 'upload' ? (
        <>
          <Path {...line} d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
          <Path {...line} d="M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3" />
        </>
      ) : null}
      {name === 'calendar' ? (
        <>
          <Path {...line} d="M5 4.5h14a2 2 0 0 1 2 2v13H3v-13a2 2 0 0 1 2-2Zm2-2v4m10-4v4M3 9h18" />
          <Path {...line} d="M7 13h2m3 0h2m3 0h1M7 16.5h2m3 0h2" />
        </>
      ) : null}
      {name === 'clock' ? (
        <>
          <Circle {...line} cx="12" cy="12" r="9" />
          <Path {...line} d="M12 7v5l3 2" />
        </>
      ) : null}
      {name === 'people' ? (
        <>
          <Circle {...line} cx="9" cy="8" r="3" />
          <Circle {...line} cx="17" cy="9" r="2" />
          <Path {...line} d="M3 20v-2a6 6 0 0 1 12 0v2m1-6a4 4 0 0 1 5 4v2" />
        </>
      ) : null}
      {name === 'sparkle' ? (
        <>
          <Path {...line} d="M12 2.5c.7 4.7 2.8 6.8 7.5 7.5-4.7.7-6.8 2.8-7.5 7.5-.7-4.7-2.8-6.8-7.5-7.5 4.7-.7 6.8-2.8 7.5-7.5Z" />
          <Path {...line} d="M19 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" />
        </>
      ) : null}
      {name === 'close' ? <Path {...line} d="m6 6 12 12M18 6 6 18" /> : null}
      {name === 'warning' ? (
        <>
          <Path {...line} d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
          <Path {...line} d="M12 9v4m0 4h.01" />
        </>
      ) : null}
      {name === 'chevronLeft' ? <Path {...line} d="m15 18-6-6 6-6" /> : null}
      {name === 'chevronRight' ? <Path {...line} d="m9 18 6-6-6-6" /> : null}
    </Svg>
  );
}
