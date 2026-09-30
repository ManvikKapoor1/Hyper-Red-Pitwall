import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="square" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const IconDash = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" />
    <rect x="9" y="2" width="5" height="3" />
    <rect x="9" y="7" width="5" height="7" />
    <rect x="2" y="9" width="5" height="5" />
  </Svg>
);
export const IconSetup = (p: P) => (
  <Svg {...p}>
    <path d="M3 2v12M8 2v12M13 2v12" />
    <rect x="1.5" y="9" width="3" height="2" fill="currentColor" />
    <rect x="6.5" y="4" width="3" height="2" fill="currentColor" />
    <rect x="11.5" y="7" width="3" height="2" fill="currentColor" />
  </Svg>
);
export const IconStrategy = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8h13" />
    <rect x="2" y="5" width="4" height="6" />
    <rect x="7.5" y="5" width="3" height="6" />
    <path d="M12.5 4v8" />
  </Svg>
);
export const IconLive = (p: P) => (
  <Svg {...p}>
    <path d="M1 8h3l2-5 3 10 2-5h4" />
  </Svg>
);
export const IconCalls = (p: P) => (
  <Svg {...p}>
    <path d="M2 3h12v8H7l-3 3v-3H2z" />
    <path d="M5 6h6M5 8.5h4" />
  </Svg>
);
export const IconData = (p: P) => (
  <Svg {...p}>
    <ellipse cx="8" cy="3.5" rx="5.5" ry="1.8" />
    <path d="M2.5 3.5v9c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8v-9M2.5 8c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8" />
  </Svg>
);
export const IconAnalysis = (p: P) => (
  <Svg {...p}>
    <path d="M2 14h12" />
    <path d="M4 12V8M7 12V4M10 12V7M13 12V2" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 3v10l8-5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M5 3v10M11 3v10" strokeWidth={2.2} />
  </Svg>
);
export const IconStep = (p: P) => (
  <Svg {...p}>
    <path d="M3 3v10l7-5z" fill="currentColor" stroke="none" />
    <path d="M12.5 3v10" strokeWidth={1.8} />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const IconUp = (p: P) => (
  <Svg {...p}>
    <path d="M4 10l4-4 4 4" />
  </Svg>
);
export const IconDown = (p: P) => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="5" width="8" height="8" />
    <path d="M3 11V3h8" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" />
  </Svg>
);
export const IconFuel = (p: P) => (
  <Svg {...p}>
    <path d="M8 2s-4 4.5-4 7.2A4 4 0 0 0 12 9.2C12 6.5 8 2 8 2z" />
  </Svg>
);
export const IconTire = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="2.5" />
  </Svg>
);
export const IconDriver = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="5.5" r="2.8" />
    <path d="M2.5 14c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
  </Svg>
);
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" />
  </Svg>
);
export const IconFlag = (p: P) => (
  <Svg {...p}>
    <path d="M3 14V2M3 2.5h9l-2 3 2 3H3" />
  </Svg>
);
export const IconWarn = (p: P) => (
  <Svg {...p}>
    <path d="M8 2l6.5 11.5h-13z" />
    <path d="M8 6.5v3.2M8 11.3v.4" />
  </Svg>
);
export const IconZoomIn = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14M5 7h4M7 5v4" />
  </Svg>
);
export const IconZoomOut = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14M5 7h4" />
  </Svg>
);
export const IconChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="M10 3L5 8l5 5" />
  </Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="M6 3l5 5-5 5" />
  </Svg>
);
export const IconDrag = (p: P) => (
  <Svg {...p}>
    <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
export const IconFocus = (p: P) => (
  <Svg {...p}>
    <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
  </Svg>
);
